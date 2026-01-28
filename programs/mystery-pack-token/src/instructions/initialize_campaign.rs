use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::{error::CampaignError, states::Campaign};

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct InitializeCampaign<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Campaign::INIT_SPACE,
        seeds = [b"campaign", seed.to_le_bytes().as_ref()],
        bump,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mint::token_program = token_program
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"sol_vault", campaign.key().as_ref()],
        bump,
    )]
    pub sol_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> InitializeCampaign<'info> {
    pub fn initialize(
        &mut self,
        seed: u64,
        merkle_root: [u8; 32],
        pack_price: u64,
        total_packs: u32,
        bumps: &InitializeCampaignBumps,
    ) -> Result<()> {
        self.campaign.set_inner(Campaign {
            seed,
            authority: self.authority.key(),
            token_mint: self.token_mint.key(),
            pack_price,
            total_packs,
            packs_sold: 0,
            merkle_root,
            is_active: true,
            bump: bumps.campaign,
            vault_bump: bumps.sol_vault,
        });

        Ok(())
    }
}

pub fn handler(
    ctx: Context<InitializeCampaign>,
    seed: u64,
    merkle_root: [u8; 32],
    pack_price: u64,
    total_packs: u32,
) -> Result<()> {
    require_gt!(pack_price, 0, CampaignError::InvalidAmount);
    require_gt!(total_packs, 0, CampaignError::InvalidAmount);

    ctx.accounts
        .initialize(seed, merkle_root, pack_price, total_packs, &ctx.bumps)?;

    Ok(())
}
