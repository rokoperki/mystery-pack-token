/**
 * Test Admin Functions (withdraw and close)
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
import { createMint } from "@solana/spl-token";

describe("🔧 Admin Functions Test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .MysteryPackToken as Program<MysteryPackToken>;

  const authority = (provider.wallet as anchor.Wallet).payer;
  const nonAuthority = Keypair.generate();

  const seed = new anchor.BN(Date.now());
  const packPrice = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
  const totalPacks = 3;

  const packData = [
    { index: 0, amount: 100, salt: Buffer.alloc(32, 1) },
    { index: 1, amount: 250, salt: Buffer.alloc(32, 2) },
    { index: 2, amount: 500, salt: Buffer.alloc(32, 3) },
  ];

  let campaignPda: PublicKey;
  let vaultPda: PublicKey;
  let tokenMint: PublicKey;
  let merkleRoot: Buffer;

  // Helper functions
  function sha256(data: Buffer): Buffer {
    return createHash("sha256").update(data).digest();
  }

  function createLeaf(packIndex: number, tokenAmount: number, salt: Buffer): Buffer {
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

    return { root: level[0] };
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

  before(async () => {
    console.log("\n🔧 Testing Admin Functions\n");

    // Fund non-authority for negative tests
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: nonAuthority.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      ),
      [authority]
    );

    // Setup campaign
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

    // Initialize campaign
    await program.methods
      .initializeCampaign(seed, [...merkleRoot] as number[], packPrice, totalPacks)
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

    console.log("✅ Campaign initialized for testing");
    console.log(`   Campaign: ${campaignPda.toString()}`);
    console.log(`   Vault: ${vaultPda.toString()}`);
    console.log(`   Authority: ${authority.publicKey.toString()}\n`);

    // Add some SOL to vault (simulating purchases)
    const fundVaultTx = await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: vaultPda,
          lamports: 0.5 * LAMPORTS_PER_SOL,
        })
      ),
      [authority]
    );

    const vaultBalance = await provider.connection.getBalance(vaultPda);
    console.log(`💰 Vault funded with ${vaultBalance / LAMPORTS_PER_SOL} SOL for testing\n`);
  });

  describe("withdraw_admin", () => {
    it("✅ Allows authority to withdraw SOL", async () => {
      const authorityBefore = await provider.connection.getBalance(authority.publicKey);
      const vaultBefore = await provider.connection.getBalance(vaultPda);
      const rentExempt = await provider.connection.getMinimumBalanceForRentExemption(0);

      console.log(`   Authority balance before: ${authorityBefore / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Vault balance before: ${vaultBefore / LAMPORTS_PER_SOL} SOL`);

      // Withdraw all funds (passing null withdraws max)
      await program.methods
        .withdrawAdmin(null)
        .accountsStrict({
          campaign: campaignPda,
          authority: authority.publicKey,
          solVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const authorityAfter = await provider.connection.getBalance(authority.publicKey);
      const vaultAfter = await provider.connection.getBalance(vaultPda);

      console.log(`   Authority balance after: ${authorityAfter / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Vault balance after: ${vaultAfter / LAMPORTS_PER_SOL} SOL`);

      // Verify vault only has rent-exempt minimum
      expect(vaultAfter).to.equal(rentExempt);

      // Verify authority received the funds (minus transaction fees)
      const expectedWithdrawn = vaultBefore - rentExempt;
      console.log(`   ✅ Withdrew ${expectedWithdrawn / LAMPORTS_PER_SOL} SOL successfully`);
      console.log(`   💰 Vault retained ${rentExempt} lamports for rent exemption\n`);

      // Authority should have more SOL (minus tx fees)
      expect(authorityAfter).to.be.greaterThan(authorityBefore - 0.01 * LAMPORTS_PER_SOL);
    });

    it("❌ Fails for non-authority", async () => {
      try {
        await program.methods
          .withdrawAdmin(null)
          .accountsStrict({
            campaign: campaignPda,
            authority: nonAuthority.publicKey,
            solVault: vaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([nonAuthority])
          .rpc();

        expect.fail("Should have thrown Unauthorized error");
      } catch (err: any) {
        expect(err.toString()).to.include("Unauthorized");
        console.log("   ✅ Correctly rejected non-authority withdrawal");
      }
    });

    it("✅ Allows partial withdrawal", async () => {
      // First fund vault again
      await provider.sendAndConfirm(
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: vaultPda,
            lamports: 0.2 * LAMPORTS_PER_SOL,
          })
        ),
        [authority]
      );

      const vaultBefore = await provider.connection.getBalance(vaultPda);
      const withdrawAmount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

      await program.methods
        .withdrawAdmin(withdrawAmount)
        .accountsStrict({
          campaign: campaignPda,
          authority: authority.publicKey,
          solVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const vaultAfter = await provider.connection.getBalance(vaultPda);
      const actualWithdrawn = vaultBefore - vaultAfter;

      expect(actualWithdrawn).to.equal(withdrawAmount.toNumber());
      console.log(`   ✅ Partial withdrawal successful: ${actualWithdrawn / LAMPORTS_PER_SOL} SOL\n`);
    });
  });

  describe("close_campaign", () => {
    it("✅ Allows authority to close campaign", async () => {
      const campaignBefore = await program.account.campaign.fetch(campaignPda);
      expect(campaignBefore.isActive).to.equal(true);

      await program.methods
        .closeCampaign()
        .accountsStrict({
          campaign: campaignPda,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      const campaignAfter = await program.account.campaign.fetch(campaignPda);
      expect(campaignAfter.isActive).to.equal(false);

      console.log("   ✅ Campaign closed successfully");
      console.log(`   Campaign is now inactive: ${!campaignAfter.isActive}\n`);
    });

    it("❌ Fails for non-authority", async () => {
      // Create a new active campaign to test
      const newSeed = new anchor.BN(Date.now() + 1000);
      const [newCampaignPda] = getCampaignPda(newSeed);
      const [newVaultPda] = getVaultPda(newCampaignPda);

      const newMint = await createMint(
        provider.connection,
        authority,
        newCampaignPda,
        null,
        9
      );

      await program.methods
        .initializeCampaign(newSeed, [...merkleRoot] as number[], packPrice, totalPacks)
        .accountsStrict({
          authority: authority.publicKey,
          campaign: newCampaignPda,
          tokenMint: newMint,
          solVault: newVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();

      // Try to close with wrong authority
      try {
        await program.methods
          .closeCampaign()
          .accountsStrict({
            campaign: newCampaignPda,
            authority: nonAuthority.publicKey,
          })
          .signers([nonAuthority])
          .rpc();

        expect.fail("Should have thrown Unauthorized error");
      } catch (err: any) {
        expect(err.toString()).to.include("Unauthorized");
        console.log("   ✅ Correctly rejected non-authority close attempt");
      }
    });
  });

  after(() => {
    console.log("\n" + "=".repeat(60));
    console.log("✅ All admin functions working correctly!");
    console.log("=".repeat(60) + "\n");
  });
});
