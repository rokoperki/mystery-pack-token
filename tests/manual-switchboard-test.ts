/**
 * Manual Switchboard Testing Guide
 *
 * This test demonstrates the full flow but requires manual Switchboard setup.
 * Follow the steps in SWITCHBOARD_TESTING_GUIDE.md
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { MysteryPackToken } from "../target/types/mystery_pack_token";
import { expect } from "chai";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import {
  createMint,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";

describe("📝 Manual Switchboard Test (Step-by-Step)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .MysteryPackToken as Program<MysteryPackToken>;

  const authority = (provider.wallet as anchor.Wallet).payer;
  const buyer = Keypair.generate();

  const seed = new anchor.BN(Date.now());
  const packPrice = new anchor.BN(0.01 * LAMPORTS_PER_SOL);
  const totalPacks = 5;

  const packData = [
    { index: 0, amount: 100, salt: Buffer.alloc(32, 1) },
    { index: 1, amount: 250, salt: Buffer.alloc(32, 2) },
    { index: 2, amount: 500, salt: Buffer.alloc(32, 3) },
    { index: 3, amount: 50, salt: Buffer.alloc(32, 4) },
    { index: 4, amount: 150, salt: Buffer.alloc(32, 5) },
  ];

  let campaignPda: PublicKey;
  let vaultPda: PublicKey;
  let tokenMint: PublicKey;
  let merkleRoot: Buffer;
  let getProof: (index: number) => Buffer[];

  // Merkle tree helpers
  function sha256(data: Buffer): Buffer {
    return createHash("sha256").update(data).digest();
  }

  function createLeaf(
    packIndex: number,
    tokenAmount: number,
    salt: Buffer
  ): Buffer {
    const data = Buffer.alloc(44);
    data.writeUInt32LE(packIndex, 0);
    data.writeBigUInt64LE(BigInt(tokenAmount), 4);
    salt.copy(data, 12);
    return sha256(data);
  }

  function hashPair(left: Buffer, right: Buffer): Buffer {
    return sha256(Buffer.concat([left, right]));
  }

  function buildMerkleTree(packs: typeof packData) {
    let level = packs.map((p) => createLeaf(p.index, p.amount, p.salt));
    const nextPow2 = Math.pow(2, Math.ceil(Math.log2(level.length)));
    while (level.length < nextPow2) {
      level.push(Buffer.alloc(32, 0));
    }

    const tree: Buffer[][] = [level];
    while (level.length > 1) {
      const nextLevel: Buffer[] = [];
      for (let i = 0; i < level.length; i += 2) {
        nextLevel.push(hashPair(level[i], level[i + 1]));
      }
      tree.push(nextLevel);
      level = nextLevel;
    }

    const root = level[0];

    function getProof(index: number): Buffer[] {
      const proof: Buffer[] = [];
      let idx = index;
      for (let i = 0; i < tree.length - 1; i++) {
        const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
        proof.push(tree[i][siblingIdx]);
        idx = Math.floor(idx / 2);
      }
      return proof;
    }

    return { root, getProof };
  }

  function getCampaignPda(campaignSeed: anchor.BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), campaignSeed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  }

  function getVaultPda(campaignPda: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), campaignPda.toBuffer()],
      program.programId
    );
  }

  function getPurchaseRequestPda(
    campaignPda: PublicKey,
    buyerPubkey: PublicKey,
    nonce: anchor.BN
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("purchase_request"),
        campaignPda.toBuffer(),
        buyerPubkey.toBuffer(),
        nonce.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
  }

  function getReceiptPda(
    campaignPda: PublicKey,
    buyerPubkey: PublicKey,
    nonce: anchor.BN
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("receipt"),
        campaignPda.toBuffer(),
        buyerPubkey.toBuffer(),
        nonce.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
  }

  before(async () => {
    console.log("\n🎯 Manual Switchboard Testing\n");
    console.log("=" + ".repeat(60)" + "\n");

    // Fund buyer
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: buyer.publicKey,
          lamports: 0.5 * LAMPORTS_PER_SOL,
        })
      ),
      [authority]
    );

    // Setup
    [campaignPda] = getCampaignPda(seed);
    [vaultPda] = getVaultPda(campaignPda);

    tokenMint = await createMint(
      provider.connection,
      authority,
      campaignPda,
      null,
      9
    );

    const tree = buildMerkleTree(packData);
    merkleRoot = tree.root;
    getProof = tree.getProof;
  });

  it("✅ Initialize Campaign", async () => {
    await program.methods
      .initializeCampaign(
        seed,
        [...merkleRoot] as number[],
        packPrice,
        totalPacks
      )
      .accountsStrict({
        authority: authority.publicKey,
        campaign: campaignPda,
        tokenMint: tokenMint,
        solVault: vaultPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    console.log("✅ Campaign initialized");
    console.log(`   Campaign: ${campaignPda.toString()}`);
  });

  it("📝 Manual Step: Create Switchboard Randomness", async () => {
    console.log("\n" + "=".repeat(60));
    console.log("🚨 MANUAL ACTION REQUIRED 🚨");
    console.log("=".repeat(60) + "\n");
    console.log("To complete this test, you need to:");
    console.log("\n1. Create a Switchboard randomness account on devnet");
    console.log("   Option A: Use Switchboard CLI");
    console.log("      $ sb randomness request --keypair ~/.config/solana/id.json");
    console.log("\n   Option B: Use Switchboard dashboard");
    console.log("      https://app.switchboard.xyz/solana/devnet\n");
    console.log("2. Copy the randomness account public key");
    console.log("\n3. Update this test file with the account:");
    console.log("   const SWITCHBOARD_RANDOMNESS = new PublicKey('YOUR_KEY_HERE');\n");
    console.log("4. Uncomment the commit/settle/claim tests below");
    console.log("\n" + "=".repeat(60) + "\n");

    // Print helpful info for manual setup
    console.log("📋 Info you'll need:");
    console.log(`   Campaign: ${campaignPda.toString()}`);
    console.log(`   Buyer: ${buyer.publicKey.toString()}`);
    console.log(`   Nonce: 1`);
    console.log(`   Pack Price: ${packPrice.toNumber() / LAMPORTS_PER_SOL} SOL\n`);
  });

  // ============================================
  // Uncomment these tests after creating Switchboard account
  // ============================================

  /*
  it("💰 Commit Purchase", async () => {
    // TODO: Replace with your Switchboard randomness account
    const SWITCHBOARD_RANDOMNESS = new PublicKey("YOUR_SWITCHBOARD_RANDOMNESS_ACCOUNT");

    const nonce = new anchor.BN(1);
    const [purchaseRequestPda] = getPurchaseRequestPda(
      campaignPda,
      buyer.publicKey,
      nonce
    );

    await program.methods
      .commitPurchase(nonce)
      .accountsStrict({
        campaign: campaignPda,
        buyer: buyer.publicKey,
        purchaseRequest: purchaseRequestPda,
        randomnessAccount: SWITCHBOARD_RANDOMNESS,
        solVault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    console.log("✅ Purchase committed");
    console.log("   Now wait 5-10 seconds for Switchboard oracle to fulfill...");
  });

  it("📦 Settle Randomness", async () => {
    const SWITCHBOARD_RANDOMNESS = new PublicKey("YOUR_SWITCHBOARD_RANDOMNESS_ACCOUNT");

    const nonce = new anchor.BN(1);
    const [purchaseRequestPda] = getPurchaseRequestPda(
      campaignPda,
      buyer.publicKey,
      nonce
    );
    const [receiptPda] = getReceiptPda(campaignPda, buyer.publicKey, nonce);

    await program.methods
      .settleRandomness()
      .accountsStrict({
        campaign: campaignPda,
        purchaseRequest: purchaseRequestPda,
        randomnessAccount: SWITCHBOARD_RANDOMNESS,
        buyer: buyer.publicKey,
        receipt: receiptPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    const receipt = await program.account.receipt.fetch(receiptPda);
    console.log(`✅ Pack assigned: #${receipt.packIndex}`);
    console.log(`   Contains: ${packData[receipt.packIndex].amount} tokens`);

    // Store for claim test
    (this as any).receiptPda = receiptPda;
    (this as any).packIndex = receipt.packIndex;
  });

  it("🎁 Claim Pack", async () => {
    const receiptPda = (this as any).receiptPda;
    const packIndex = (this as any).packIndex;
    const pack = packData[packIndex];
    const proof = getProof(packIndex);

    const buyerAta = getAssociatedTokenAddressSync(tokenMint, buyer.publicKey);

    await program.methods
      .claimPack(
        new anchor.BN(pack.amount),
        [...pack.salt] as number[],
        proof.map((p) => [...p] as number[])
      )
      .accountsStrict({
        campaign: campaignPda,
        receipt: receiptPda,
        buyer: buyer.publicKey,
        buyerTokenAccount: buyerAta,
        tokenMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    const tokenAccount = await getAccount(provider.connection, buyerAta);
    expect(tokenAccount.amount.toString()).to.equal(pack.amount.toString());

    console.log(`✅ Claimed ${pack.amount} tokens successfully!`);
  });
  */
});
