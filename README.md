# Mystery Pack Token

A Solana program for selling mystery packs with provably fair contents.

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
┌─────────────┐    purchase     ┌─────────────┐     claim      ┌─────────────┐
│    User     │ ──────────────► │   Receipt   │ ─────────────► │   Tokens    │
│             │    (SOL)        │  (pack #N)  │   (proof)      │  (minted)   │
└─────────────┘                 └─────────────┘                └─────────────┘
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

### Phase 2: Purchase
```
User calls purchase_pack():
1. Pays pack_price in SOL
2. Receives receipt with pack_index = N
3. Contents still unknown to user
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
| User claims different pack | Receipt has fixed pack_index |

The backend can ONLY produce valid proofs for the originally committed amounts.

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
│                        Campaign PDA                          │
│  seeds: ["campaign", seed]                                  │
├─────────────────────────────────────────────────────────────┤
│  authority: Pubkey     ──► Admin who can withdraw/close     │
│  token_mint: Pubkey    ──► Token to distribute              │
│  merkle_root: [u8;32]  ──► Immutable commitment             │
│  pack_price: u64       ──► Cost per pack                    │
│  total_packs: u32      ──► Maximum packs                    │
│  packs_sold: u32       ──► Sequential counter               │
│  is_active: bool       ──► Sales enabled                    │
└─────────────────────────────────────────────────────────────┘
            │
            │ has many
            ▼
┌─────────────────────────────────────────────────────────────┐
│                        Receipt PDA                           │
│  seeds: ["receipt", campaign, pack_index]                   │
├─────────────────────────────────────────────────────────────┤
│  campaign: Pubkey      ──► Parent campaign                  │
│  buyer: Pubkey         ──► Owner of this pack               │
│  pack_index: u32       ──► Which pack (0, 1, 2...)          │
│  is_claimed: bool      ──► Already opened?                  │
└─────────────────────────────────────────────────────────────┘
            │
            │ references
            ▼
┌─────────────────────────────────────────────────────────────┐
│                        Vault PDA                             │
│  seeds: ["vault", campaign]                                 │
├─────────────────────────────────────────────────────────────┤
│  Holds collected SOL from pack sales                        │
│  Only authority can withdraw                                │
└─────────────────────────────────────────────────────────────┘
```

## Security Model

| Layer | Protection |
|-------|------------|
| Cryptographic | SHA256 Merkle proofs |
| Ownership | Receipt.buyer == signer |
| State | is_claimed prevents double-claim |
| Authority | has_one checks on admin functions |
| Immutability | Merkle root cannot change |

## Instructions

### initialize_campaign

Creates a new campaign with Merkle root commitment.

**Accounts:**

| Name | Writable | Signer | Description |
|------|----------|--------|-------------|
| authority | ✓ | ✓ | Campaign creator |
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
| total_packs | u32 | Total packs available |

**Errors:**
- `InvalidAmount` - price or total_packs is zero
- `InvalidMintAuthority` - campaign pda not mint authority

---

### purchase_pack

Buys a pack and creates ownership receipt.

**Accounts:**

| Name | Writable | Signer | Description |
|------|----------|--------|-------------|
| campaign | ✓ | | Campaign to purchase from |
| buyer | ✓ | ✓ | User buying pack |
| receipt | ✓ | | PDA: `["receipt", campaign, packs_sold]` |
| sol_vault | ✓ | | Receives SOL payment |
| system_program | | | System program |

**Arguments:** None

**Errors:**
- `CampaignNotActive` - campaign is closed
- `SoldOut` - all packs purchased

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
- `ProofTooLong` - proof lenght exceeds 20

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

---

## Account Schemas

### Campaign

| Field | Type | Offset | Size |
|-------|------|--------|------|
| seed | u64 | 8 | 8 |
| authority | Pubkey | 16 | 32 |
| token_mint | Pubkey | 48 | 32 |
| pack_price | u64 | 80 | 8 |
| total_packs | u32 | 88 | 4 |
| packs_sold | u32 | 92 | 4 |
| merkle_root | [u8; 32] | 96 | 32 |
| is_active | bool | 128 | 1 |
| bump | u8 | 129 | 1 |
| vault_bump | u8 | 130 | 1 |

**Total size:** 8 (discriminator) + 123 = 131 bytes

### Receipt

| Field | Type | Offset | Size |
|-------|------|--------|------|
| campaign | Pubkey | 8 | 32 |
| buyer | Pubkey | 40 | 32 |
| pack_index | u32 | 72 | 4 |
| is_claimed | bool | 76 | 1 |

**Total size:** 8 (discriminator) + 69 = 77 bytes

---

## Error Codes

| Code | Name | Message |
|------|------|---------|
| 6000 | InvalidAmount | Price or total_packs must be > 0 |
| 6001 | CampaignNotActive | Campaign is closed |
| 6002 | SoldOut | All packs purchased |
| 6003 | NotPackOwner | Signer doesn't own this pack |
| 6004 | AlreadyClaimed | Pack already claimed |
| 6005 | InvalidProof | Merkle verification failed |
| 6006 | InvalidMint | Token mint mismatch |
| 6007 | Unauthorized | Not campaign authority |
| 6008 | InsufficientFunds | Withdrawal exceeds balance |
| 6009 | InvalidMintAuthority | Program not mint authority |
| 6010 | ProofTooLong | Proof exceeds 20 levels |

---

## PDA Derivation
```typescript
// Campaign
const [campaign] = PublicKey.findProgramAddressSync(
  [Buffer.from("campaign"), seed.toArrayLike(Buffer, "le", 8)],
  programId
);

// Vault
const [vault] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), campaign.toBuffer()],
  programId
);

// Receipt
const [receipt] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("receipt"),
    campaign.toBuffer(),
    new BN(packIndex).toArrayLike(Buffer, "le", 4)
  ],
  programId
);
```
