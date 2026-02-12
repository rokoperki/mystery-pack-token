# Mystery Pack Token

A Solana program for selling mystery packs with provably fair contents using Merkle trees and Switchboard on-demand randomness.

## Prerequisites

- Rust 1.70+
- Solana CLI 1.17+
- Anchor 0.29+
- Node.js 18+

## Setup
```bash
# Clone repository
git clone https://github.com/rokoperki/mystery-pack-token.git
cd mystery-pack-token

# Install dependencies
yarn install

# Build program
anchor build

# Run tests
anchor test
```

## Deploy
```bash
# Get program ID
solana address -k target/deploy/mystery_pack_token-keypair.json

# Update Anchor.toml and lib.rs with program ID

# Deploy to devnet
solana config set --url devnet
anchor deploy

# Deploy to mainnet
solana config set --url mainnet-beta
anchor deploy --provider.cluster mainnet
```

## System Overview
```
┌──────────┐  commit_purchase  ┌───────────────────┐  settle_randomness  ┌─────────────┐  claim_pack  ┌─────────────┐
│   User   │ ────────────────► │ PurchaseRequest   │ ──────────────────► │   Receipt   │ ───────────► │   Tokens    │
│          │   (SOL + RNG)     │ (pending random)  │   (random pack #)   │  (pack #N)  │  (proof)     │  (minted)   │
└──────────┘                   └───────────────────┘                     └─────────────┘              └─────────────┘
```

### Phase 1: Setup (Before Sales)
```
1. Generate pack contents offline:
   Pack 0: 100 tokens, salt: 0x1a2b...
   Pack 1: 250 tokens, salt: 0x3c4d...
   Pack 2: 50 tokens,  salt: 0x5e6f...
   ...

2. Create leaf for each pack:
   leaf = sha256(pack_index || token_amount || salt)
         (4 bytes)    (8 bytes)     (32 bytes)

3. Build Merkle tree:
                    Root ◄─── Stored on-chain (32 bytes)
                   /    \
               H(0,1)   H(2,3)
               /   \    /    \
           Leaf0 Leaf1 Leaf2 Leaf3

4. Store ONLY the root on-chain
   - Commits to ALL pack contents
   - Cannot be changed after deployment
```

### Phase 2: Purchase (Two-Step with Randomness)
```
Step 1 — commit_purchase():
  1. User pays pack_price in SOL (5% fee + 95% to vault)
  2. User specifies a Switchboard randomness account
  3. Program records commit_slot from randomness account
  4. PurchaseRequest PDA is created (pending settlement)

Step 2 — settle_randomness():
  1. Switchboard oracle fulfills randomness
  2. User (or cranker) calls settle_randomness
  3. Program reads revealed random value
  4. Random value selects pack from available bitmap
  5. Receipt PDA is created with assigned pack_index
  6. PurchaseRequest account is closed (rent returned to buyer)
```

### Phase 3: Claim
```
User requests reveal from backend:
→ Backend returns: { amount: 250, salt: 0x3c4d..., proof: [...] }

User calls claim_pack(amount, salt, proof):
1. Program reconstructs leaf:
   leaf = sha256(pack_index || 250 || 0x3c4d...)

2. Program verifies Merkle proof:
   - Hashes leaf with siblings up the tree
   - Compares final hash with stored root

3. If match → mint 250 tokens
   If no match → reject (backend lied)
```

## Why It's Trustless

| Scenario | Result |
|----------|--------|
| Backend claims wrong amount | Proof verification fails |
| Backend uses wrong salt | Leaf hash differs, proof fails |
| Admin tries to change contents | Root is immutable on-chain |
| User tries to claim different pack | Receipt has fixed pack_index |
| User tries to predict pack assignment | Switchboard randomness is unpredictable |
| User tries to manipulate random result | commit_slot locks in randomness source before reveal |

The backend can ONLY produce valid proofs for the originally committed amounts. Pack assignment is determined by Switchboard on-chain randomness, not by the backend.

## Fee Mechanism

A 5% platform fee is applied to every pack purchase:

```
pack_price = 1 SOL

fee_amount  = 1 SOL × 5% = 0.05 SOL  → fee_recipient
vault_amount = 1 SOL - 0.05 = 0.95 SOL → campaign vault
```

- Fee is transferred directly during `commit_purchase`
- Fee recipient address is hardcoded in the program and validated on-chain

## Randomness Flow (Switchboard On-Demand)

```
                    commit_purchase              Oracle Fulfills              settle_randomness
User ──────────────────────────────► Chain ◄──────────────────── Switchboard ──────────────────► Chain
  │                                    │                                          │
  │ 1. Pay SOL                         │ 2. Record commit_slot                    │ 5. Read random value
  │    + specify RNG account           │ 3. Create PurchaseRequest                │ 6. Select nth available pack
  │                                    │ 4. Oracle reveals randomness             │ 7. Create Receipt
  │                                    │                                          │ 8. Close PurchaseRequest
```

**How pack selection works:**
1. Campaign tracks available packs in a 256-bit bitmap (1 = available, 0 = taken)
2. Random value is mapped to `random_index = random_value % available_count`
3. `get_nth_available(random_index)` walks the bitmap to find the Nth available pack
4. The selected pack is marked as taken in the bitmap

## Merkle Proof Verification
```
Given: leaf, proof[], pack_index, stored_root

Algorithm:
  hash = leaf
  index = pack_index

  for sibling in proof:
      if index is even:
          hash = sha256(hash || sibling)
      else:
          hash = sha256(sibling || hash)
      index = index / 2

  return hash == stored_root
```

## Account Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                        Campaign PDA                         │
│  seeds: ["campaign", seed]                                  │
├─────────────────────────────────────────────────────────────┤
│  authority: Pubkey       ──► Admin who can withdraw/close   │
│  token_mint: Pubkey      ──► Token to distribute            │
│  merkle_root: [u8;32]    ──► Immutable commitment           │
│  pack_price: u64         ──► Cost per pack                  │
│  total_packs: u32        ──► Maximum packs                  │
│  packs_sold: u32         ──► Settled pack counter           │
│  packs_committed: u32    ──► Pending settlement counter     │
│  available_bitmap: [u8;32] ► Bitmap of available packs      │
│  is_active: bool         ──► Sales enabled                  │
└─────────────────────────────────────────────────────────────┘
            │
            │ has many (temporary, closed after settle)
            ▼
┌─────────────────────────────────────────────────────────────┐
│                     PurchaseRequest PDA                     │
│  seeds: ["purchase_request", campaign, buyer, nonce]        │
├─────────────────────────────────────────────────────────────┤
│  campaign: Pubkey        ──► Parent campaign                │
│  buyer: Pubkey           ──► User who committed             │
│  commit_slot: u64        ──► Switchboard seed slot          │
│  randomness_account: Pubkey ► Switchboard RNG account       │
│  nonce: u64              ──► Unique per buyer per campaign  │
│  pack_index: Option<u32> ──► None until settled             │
│  bump: u8                ──► PDA bump seed                  │
└─────────────────────────────────────────────────────────────┘
            │
            │ settles into
            ▼
┌─────────────────────────────────────────────────────────────┐
│                        Receipt PDA                          │
│  seeds: ["receipt", campaign, buyer, nonce]                 │
├─────────────────────────────────────────────────────────────┤
│  campaign: Pubkey        ──► Parent campaign                │
│  buyer: Pubkey           ──► Owner of this pack             │
│  pack_index: u32         ──► Randomly assigned pack         │
│  nonce: u64              ──► Links to original purchase     │
│  is_claimed: bool        ──► Already opened?                │
└─────────────────────────────────────────────────────────────┘
            │
            │ references
            ▼
┌─────────────────────────────────────────────────────────────┐
│                        Vault PDA                            │
│  seeds: ["vault", campaign]                                 │
├─────────────────────────────────────────────────────────────┤
│  Holds collected SOL from pack sales (95% after fee)        │
│  Only authority can withdraw                                │
└─────────────────────────────────────────────────────────────┘
```

## Security Model

| Layer | Protection |
|-------|------------|
| Cryptographic | SHA256 Merkle proofs |
| Randomness | Switchboard on-demand oracle (commit-reveal pattern) |
| Fairness | Bitmap-based pack selection prevents manipulation |
| Ownership | Receipt.buyer == signer |
| State | is_claimed prevents double-claim |
| Authority | has_one checks on admin functions |
| Immutability | Merkle root cannot change |
| Fee integrity | Fee recipient hardcoded and validated on-chain |

## Instructions

### initialize_campaign

Creates a new campaign with Merkle root commitment.

**Accounts:**

| Name | Writable | Signer | Description |
|------|----------|--------|-------------|
| authority | ✓ | ✓ | Campaign creator |
| fee_recipient | ✓ | ✓ | Platform fee recipient (validated against constant) |
| campaign | ✓ | | PDA: `["campaign", seed]` |
| token_mint | | | SPL token to distribute |
| sol_vault | ✓ | | PDA: `["vault", campaign]` |
| system_program | | | `11111111111111111111111111111111` |
| token_program | | | Token program ID |

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| seed | u64 | Unique campaign identifier |
| merkle_root | [u8; 32] | Root hash of pack contents tree |
| pack_price | u64 | Price per pack in lamports |
| total_packs | u32 | Total packs available (1-100) |

**Errors:**
- `InvalidAmount` - price is zero or total_packs out of range
- `InvalidMintAuthority` - campaign PDA is not the mint authority
- `InvalidFeeRecipient` - fee recipient doesn't match hardcoded address

---

### commit_purchase

Commits to a purchase by paying SOL and specifying a Switchboard randomness account. Creates a PurchaseRequest that must be settled after randomness is revealed.

**Accounts:**

| Name | Writable | Signer | Description |
|------|----------|--------|-------------|
| campaign | ✓ | | Campaign to purchase from |
| buyer | ✓ | ✓ | User buying pack |
| purchase_request | ✓ | | PDA: `["purchase_request", campaign, buyer, nonce]` |
| randomness_account | | | Switchboard randomness account |
| sol_vault | ✓ | | Receives 95% of payment |
| fee_recipient | ✓ | | Receives 5% platform fee |
| system_program | | | System program |

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| nonce | u64 | Unique identifier for this purchase (allows multiple purchases per buyer) |

**Errors:**
- `CampaignNotActive` - campaign is closed
- `SoldOut` - all packs purchased or committed
- `InvalidRandomnessAccount` - cannot parse Switchboard randomness data
- `InvalidFeeRecipient` - fee recipient doesn't match hardcoded address
- `InvalidAmount` - arithmetic overflow in fee calculation

---

### settle_randomness

Settles a pending purchase by reading the revealed randomness and assigning a random pack. Closes the PurchaseRequest and creates a Receipt.

**Accounts:**

| Name | Writable | Signer | Description |
|------|----------|--------|-------------|
| campaign | ✓ | | Campaign configuration |
| purchase_request | ✓ | | PurchaseRequest to settle (closed after) |
| randomness_account | | | Must match purchase_request.randomness_account |
| buyer | ✓ | ✓ | Must match purchase_request.buyer |
| receipt | ✓ | | PDA: `["receipt", campaign, buyer, nonce]` |
| system_program | | | System program |

**Arguments:** None

**Errors:**
- `Unauthorized` - buyer doesn't match purchase request
- `AlreadySettled` - purchase already settled
- `InvalidRandomnessAccount` - cannot parse Switchboard data
- `RandomnessSlotMismatch` - seed_slot doesn't match commit_slot
- `RandomnessNotReady` - oracle hasn't revealed yet
- `SoldOut` - no packs available
- `NoPacksAvailable` - bitmap exhausted

---

### claim_pack

Claims tokens by providing Merkle proof.

**Accounts:**

| Name | Writable | Signer | Description |
|------|----------|--------|-------------|
| campaign | | | Campaign configuration |
| receipt | ✓ | | User's purchase receipt |
| buyer | ✓ | ✓ | Must match receipt.buyer |
| token_mint | ✓ | | Token to mint |
| buyer_token_account | ✓ | | User's ATA for token |
| system_program | | | System program |
| token_program | | | Token program |
| associated_token_program | | | ATA program |

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| token_amount | u64 | Claimed token amount |
| salt | [u8; 32] | Random salt for this pack |
| proof | Vec<[u8; 32]> | Merkle proof siblings |

**Errors:**
- `NotPackOwner` - signer doesn't own receipt
- `AlreadyClaimed` - pack already claimed
- `InvalidMint` - wrong token mint
- `InvalidProof` - Merkle verification failed
- `ProofTooLong` - proof length exceeds 20

---

### withdraw_admin

Withdraws SOL from vault.

**Accounts:**

| Name | Writable | Signer | Description |
|------|----------|--------|-------------|
| campaign | | | Campaign configuration |
| authority | ✓ | ✓ | Must match campaign.authority |
| sol_vault | ✓ | | Source of funds |
| system_program | | | System program |

**Arguments:**

| Name | Type | Description |
|------|------|-------------|
| amount | Option\<u64\> | Amount to withdraw (None = all) |

**Errors:**
- `Unauthorized` - signer not authority
- `InsufficientFunds` - amount exceeds balance

---

### close_campaign

Stops all future sales.

**Accounts:**

| Name | Writable | Signer | Description |
|------|----------|--------|-------------|
| campaign | ✓ | | Campaign to close |
| authority | | ✓ | Must match campaign.authority |

**Arguments:** None

**Errors:**
- `Unauthorized` - signer not authority
- `CampaignNotActive` - already closed

