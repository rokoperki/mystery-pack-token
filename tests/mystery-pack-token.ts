import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import { createHash } from "crypto";
import { MysteryPackToken } from "../target/types/mystery_pack_token";
import { expect } from "chai";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { createMint, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";

describe("mystery-pack", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MysteryPackToken as Program<MysteryPackToken>;

  // Test accounts
  const authority = Keypair.generate();
  const buyer = Keypair.generate();

  // Campaign params
  const seed = new anchor.BN(1);
  const packPrice = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
  const totalPacks = 10;

  // Pack data (what backend would generate)
  const packData = [
    { index: 0, amount: 100, salt: Buffer.alloc(32, 1) },
    { index: 1, amount: 250, salt: Buffer.alloc(32, 2) },
    { index: 2, amount: 500, salt: Buffer.alloc(32, 3) },
    { index: 3, amount: 50, salt: Buffer.alloc(32, 4) },
    { index: 4, amount: 150, salt: Buffer.alloc(32, 5) },
    { index: 5, amount: 75, salt: Buffer.alloc(32, 6) },
    { index: 6, amount: 1000, salt: Buffer.alloc(32, 7) },
    { index: 7, amount: 200, salt: Buffer.alloc(32, 8) },
    { index: 8, amount: 125, salt: Buffer.alloc(32, 9) },
    { index: 9, amount: 300, salt: Buffer.alloc(32, 10) },
  ];

  // Merkle tree helpers
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

  // Build Merkle tree and return root + proof function
  function buildMerkleTree(packs: typeof packData) {
    // Create leaves
    let level = packs.map((p) => createLeaf(p.index, p.amount, p.salt));

    // Pad to power of 2
    const nextPow2 = Math.pow(2, Math.ceil(Math.log2(level.length)));
    while (level.length < nextPow2) {
      level.push(Buffer.alloc(32, 0));
    }

    // Store all levels for proof generation
    const tree: Buffer[][] = [level];

    // Build tree
    while (level.length > 1) {
      const nextLevel: Buffer[] = [];
      for (let i = 0; i < level.length; i += 2) {
        nextLevel.push(hashPair(level[i], level[i + 1]));
      }
      tree.push(nextLevel);
      level = nextLevel;
    }

    const root = level[0];

    // Generate proof for a specific index
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

  // PDAs
  let campaignPda: PublicKey;
  let vaultPda: PublicKey;
  let tokenMint: PublicKey;
  let merkleRoot: Buffer;
  let getProof: (index: number) => Buffer[];

  before(async () => {
    // Airdrop to authority and buyer
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(authority.publicKey, 10 * LAMPORTS_PER_SOL)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(buyer.publicKey, 10 * LAMPORTS_PER_SOL)
    );

    // Derive PDAs
    [campaignPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), campaignPda.toBuffer()],
      program.programId
    );

    // Create token mint with campaign PDA as mint authority
    tokenMint = await createMint(
      provider.connection,
      authority,
      campaignPda, // Mint authority is the campaign PDA
      null,
      9,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );

    // Build Merkle tree
    const tree = buildMerkleTree(packData);
    merkleRoot = tree.root;
    getProof = tree.getProof;
  });

  describe("initialize_campaign", () => {
    it("creates a campaign with correct parameters", async () => {
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

      // Verify campaign state
      const campaign = await program.account.campaign.fetch(campaignPda);
      expect(campaign.authority.toString()).to.equal(authority.publicKey.toString());
      expect(campaign.tokenMint.toString()).to.equal(tokenMint.toString());
      expect(campaign.packPrice.toNumber()).to.equal(packPrice.toNumber());
      expect(campaign.totalPacks).to.equal(totalPacks);
      expect(campaign.packsSold).to.equal(0);
      expect(campaign.isActive).to.equal(true);
      expect(Buffer.from(campaign.merkleRoot)).to.deep.equal(merkleRoot);
    });

    it("fails with zero pack price", async () => {
      const badSeed = new anchor.BN(999);
      const [badCampaignPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), badSeed.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [badVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), badCampaignPda.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .initializeCampaign(
            badSeed,
            [...merkleRoot] as number[],
            new anchor.BN(0), // Zero price
            totalPacks
          )
          .accountsStrict({
            authority: authority.publicKey,
            campaign: badCampaignPda,
            tokenMint: tokenMint,
            solVault: badVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([authority])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err.message).to.include("InvalidAmount");
      }
    });
  });

  describe("purchase_pack", () => {
    it("allows user to purchase a pack", async () => {
      const [receiptPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("receipt"),
          campaignPda.toBuffer(),
          Buffer.from([0, 0, 0, 0]), // pack_index 0 as u32 le bytes
        ],
        program.programId
      );

      const vaultBefore = await provider.connection.getBalance(vaultPda);

      await program.methods
        .purchasePack()
        .accountsStrict({
          campaign: campaignPda,
          buyer: buyer.publicKey,
          receipt: receiptPda,
          solVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();

      // Verify receipt
      const receipt = await program.account.receipt.fetch(receiptPda);
      expect(receipt.buyer.toString()).to.equal(buyer.publicKey.toString());
      expect(receipt.packIndex).to.equal(0);
      expect(receipt.isClaimed).to.equal(false);

      // Verify campaign updated
      const campaign = await program.account.campaign.fetch(campaignPda);
      expect(campaign.packsSold).to.equal(1);

      // Verify SOL transferred
      const vaultAfter = await provider.connection.getBalance(vaultPda);
      expect(vaultAfter - vaultBefore).to.equal(packPrice.toNumber());
    });

    it("assigns sequential pack indices", async () => {
      const [receiptPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("receipt"),
          campaignPda.toBuffer(),
          Buffer.from([1, 0, 0, 0]), // pack_index 1
        ],
        program.programId
      );

      await program.methods
        .purchasePack()
        .accountsStrict({
          campaign: campaignPda,
          buyer: buyer.publicKey,
          receipt: receiptPda,
          solVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();

      const receipt = await program.account.receipt.fetch(receiptPda);
      expect(receipt.packIndex).to.equal(1);
    });
  });

  describe("claim_pack", () => {
    it("allows user to claim with valid proof", async () => {
      const packIndex = 0;
      const pack = packData[packIndex];

      const [receiptPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("receipt"),
          campaignPda.toBuffer(),
          Buffer.from(new Uint32Array([packIndex]).buffer),
        ],
        program.programId
      );

      const buyerAta = getAssociatedTokenAddressSync(
        tokenMint,
        buyer.publicKey,
        false,
        TOKEN_PROGRAM_ID
      );

      const proof = getProof(packIndex);

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
          tokenMint: tokenMint,
          buyerTokenAccount: buyerAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        })
        .signers([buyer])
        .rpc();

      // Verify receipt marked as claimed
      const receipt = await program.account.receipt.fetch(receiptPda);
      expect(receipt.isClaimed).to.equal(true);

      // Verify tokens received
      const tokenAccount = await getAccount(
        provider.connection,
        buyerAta,
        undefined,
        TOKEN_PROGRAM_ID
      );
      expect(Number(tokenAccount.amount)).to.equal(pack.amount);
    });

    it("fails with invalid proof", async () => {
      const packIndex = 1;
      const pack = packData[packIndex];

      const [receiptPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("receipt"),
          campaignPda.toBuffer(),
          Buffer.from(new Uint32Array([packIndex]).buffer),
        ],
        program.programId
      );

      const buyerAta = getAssociatedTokenAddressSync(
        tokenMint,
        buyer.publicKey,
        false,
        TOKEN_PROGRAM_ID
      );

      // Wrong amount = invalid proof
      try {
        await program.methods
          .claimPack(
            new anchor.BN(9999), // Wrong amount
            [...pack.salt] as number[],
            getProof(packIndex).map((p) => [...p] as number[])
          )
          .accountsStrict({
            campaign: campaignPda,
            receipt: receiptPda,
            buyer: buyer.publicKey,
            tokenMint: tokenMint,
            buyerTokenAccount: buyerAta,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          })
          .signers([buyer])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err.message).to.include("InvalidProof");
      }
    });

    it("fails if already claimed", async () => {
      const packIndex = 0;
      const pack = packData[packIndex];

      const [receiptPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("receipt"),
          campaignPda.toBuffer(),
          Buffer.from(new Uint32Array([packIndex]).buffer),
        ],
        program.programId
      );

      const buyerAta = getAssociatedTokenAddressSync(
        tokenMint,
        buyer.publicKey,
        false,
        TOKEN_PROGRAM_ID
      );

      try {
        await program.methods
          .claimPack(
            new anchor.BN(pack.amount),
            [...pack.salt] as number[],
            getProof(packIndex).map((p) => [...p] as number[])
          )
          .accountsStrict({
            campaign: campaignPda,
            receipt: receiptPda,
            buyer: buyer.publicKey,
            tokenMint: tokenMint,
            buyerTokenAccount: buyerAta,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          })
          .signers([buyer])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err.message).to.include("AlreadyClaimed");
      }
    });
  });

  describe("security tests", () => {
  
    // 1. Someone tries to claim another user's pack
    it("prevents claiming someone else's pack", async () => {
      const attacker = Keypair.generate();
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(attacker.publicKey, 5 * LAMPORTS_PER_SOL)
      );
  
      const packIndex = 1; // Pack owned by buyer
      const pack = packData[packIndex];
  
      const [receiptPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("receipt"),
          campaignPda.toBuffer(),
          Buffer.from(new Uint32Array([packIndex]).buffer),
        ],
        program.programId
      );
  
      const attackerAta = getAssociatedTokenAddressSync(
        tokenMint,
        attacker.publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
  
      try {
        await program.methods
          .claimPack(
            new anchor.BN(pack.amount),
            [...pack.salt] as number[],
            getProof(packIndex).map((p) => [...p] as number[])
          )
          .accountsStrict({
            campaign: campaignPda,
            receipt: receiptPda,
            buyer: attacker.publicKey, // Attacker trying to claim
            tokenMint: tokenMint,
            buyerTokenAccount: attackerAta,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          })
          .signers([attacker])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("NotPackOwner");
      }
    });
  
    // 2. Wrong salt (valid amount, wrong salt = invalid proof)
    it("fails with wrong salt", async () => {
      // First buy a new pack
      const packIndex = 2;
      const [receiptPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("receipt"),
          campaignPda.toBuffer(),
          Buffer.from(new Uint32Array([packIndex]).buffer),
        ],
        program.programId
      );
  
      await program.methods
        .purchasePack()
        .accountsStrict({
          campaign: campaignPda,
          buyer: buyer.publicKey,
          receipt: receiptPda,
          solVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();
  
      const pack = packData[packIndex];
      const wrongSalt = Buffer.alloc(32, 99); // Wrong salt
  
      const buyerAta = getAssociatedTokenAddressSync(
        tokenMint,
        buyer.publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
  
      try {
        await program.methods
          .claimPack(
            new anchor.BN(pack.amount), // Correct amount
            [...wrongSalt] as number[], // Wrong salt
            getProof(packIndex).map((p) => [...p] as number[])
          )
          .accountsStrict({
            campaign: campaignPda,
            receipt: receiptPda,
            buyer: buyer.publicKey,
            tokenMint: tokenMint,
            buyerTokenAccount: buyerAta,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          })
          .signers([buyer])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("InvalidProof");
      }
    });
  
    // 3. Sold out check
    it("prevents purchase when sold out", async () => {
      // Create a new campaign with only 1 pack
      const smallSeed = new anchor.BN(777);
      const [smallCampaignPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"), smallSeed.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [smallVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), smallCampaignPda.toBuffer()],
        program.programId
      );
  
      // Create new mint for this campaign
      const smallMint = await createMint(
        provider.connection,
        authority,
        smallCampaignPda,
        null,
        9,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );
  
      // Initialize with only 1 pack
      await program.methods
        .initializeCampaign(
          smallSeed,
          [...merkleRoot] as number[],
          packPrice,
          1 // Only 1 pack!
        )
        .accountsStrict({
          authority: authority.publicKey,
          campaign: smallCampaignPda,
          tokenMint: smallMint,
          solVault: smallVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();
  
      // Buy the only pack
      const [receipt0] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("receipt"),
          smallCampaignPda.toBuffer(),
          Buffer.from([0, 0, 0, 0]),
        ],
        program.programId
      );
  
      await program.methods
        .purchasePack()
        .accountsStrict({
          campaign: smallCampaignPda,
          buyer: buyer.publicKey,
          receipt: receipt0,
          solVault: smallVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();
  
      // Try to buy another - should fail
      const [receipt1] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("receipt"),
          smallCampaignPda.toBuffer(),
          Buffer.from([1, 0, 0, 0]),
        ],
        program.programId
      );
  
      try {
        await program.methods
          .purchasePack()
          .accountsStrict({
            campaign: smallCampaignPda,
            buyer: buyer.publicKey,
            receipt: receipt1,
            solVault: smallVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([buyer])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("SoldOut");
      }
    });
  
    // 4. Wrong token mint on claim
    it("fails claim with wrong token mint", async () => {
      const packIndex = 2;
      const pack = packData[packIndex];
  
      const [receiptPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("receipt"),
          campaignPda.toBuffer(),
          Buffer.from(new Uint32Array([packIndex]).buffer),
        ],
        program.programId
      );
  
      // Create a fake mint
      const fakeMint = await createMint(
        provider.connection,
        authority,
        authority.publicKey,
        null,
        9,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );
  
      const buyerFakeAta = getAssociatedTokenAddressSync(
        fakeMint,
        buyer.publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
  
      try {
        await program.methods
          .claimPack(
            new anchor.BN(pack.amount),
            [...pack.salt] as number[],
            getProof(packIndex).map((p) => [...p] as number[])
          )
          .accountsStrict({
            campaign: campaignPda,
            receipt: receiptPda,
            buyer: buyer.publicKey,
            tokenMint: fakeMint, // Wrong mint!
            buyerTokenAccount: buyerFakeAta,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          })
          .signers([buyer])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("InvalidMint");
      }
    });
  });

  describe("withdraw_admin", () => {
    it("allows authority to withdraw SOL", async () => {
      const authorityBefore = await provider.connection.getBalance(authority.publicKey);
      const vaultBefore = await provider.connection.getBalance(vaultPda);

      await program.methods
        .withdrawAdmin(null) // Withdraw all
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

      expect(vaultAfter).to.equal(0);
      expect(authorityAfter).to.be.greaterThan(authorityBefore);
    });

    it("fails for non-authority", async () => {
      try {
        await program.methods
          .withdrawAdmin(null)
          .accountsStrict({
            campaign: campaignPda,
            authority: buyer.publicKey, // Wrong authority
            solVault: vaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([buyer])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err.message).to.include("Unauthorized");
      }
    });
  });

  describe("close_campaign", () => {
    it("allows authority to close campaign", async () => {
      await program.methods
        .closeCampaign()
        .accountsStrict({
          campaign: campaignPda,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      const campaign = await program.account.campaign.fetch(campaignPda);
      expect(campaign.isActive).to.equal(false);
    });

    it("prevents purchases after closing", async () => {
      const [receiptPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("receipt"),
          campaignPda.toBuffer(),
          Buffer.from([3, 0, 0, 0]),
        ],
        program.programId
      );

      try {
        await program.methods
          .purchasePack()
          .accountsStrict({
            campaign: campaignPda,
            buyer: buyer.publicKey,
            receipt: receiptPda,
            solVault: vaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([buyer])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err.message).to.include("CampaignNotActive");
      }
    });
  });
  
});