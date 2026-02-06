use anchor_lang::prelude::*;

mod error;
mod instructions;
mod states;
mod utils;
use instructions::*;

declare_id!("AM6pwecsQXLf7UViTd6jHxAYDwSXSTNfqcZ5aSjXoKEn");

#[program]
pub mod mystery_pack_token {
    use super::*;

    #[instruction(discriminator = 0)]
    pub fn initialize_campaign(
        ctx: Context<InitializeCampaign>,
        seed: u64,
        merkle_root: [u8; 32],
        pack_price: u64,
        total_packs: u32,
    ) -> Result<()> {
        instructions::initialize_campaign::handler(ctx, seed, merkle_root, pack_price, total_packs)
    }

    #[instruction(discriminator = 1)]
    pub fn commit_purchase(ctx: Context<CommitPurchase>, nonce: u64) -> Result<()> {
        instructions::commit_purchase::handler(ctx, nonce)
    }

    #[instruction(discriminator = 2)]
    pub fn settle_randomness(ctx: Context<SettleRandomness>) -> Result<()> {
        instructions::settle_randomness::handler(ctx)
    }

    #[instruction(discriminator = 3)]
    pub fn claim_pack(
        ctx: Context<ClaimPack>,
        token_amount: u64,
        salt: [u8; 32],
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        instructions::claim_pack::handler(ctx, token_amount, salt, proof)
    }

    #[instruction(discriminator = 4)]
    pub fn withdraw_admin(ctx: Context<WithdrawAdmin>, amount: Option<u64>) -> Result<()> {
        instructions::withdraw_admin::handler(ctx, amount)
    }

    #[instruction(discriminator = 5)]
    pub fn close_campaign(ctx: Context<CloseCampaign>) -> Result<()> {
        instructions::close_campaign::handler(ctx)
    }
}
