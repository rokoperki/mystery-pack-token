use crate::{error::CampaignError, states::Campaign};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CloseCampaign<'info> {
    #[account(
        mut,
        seeds = [b"campaign", campaign.seed.to_le_bytes().as_ref()],
        bump = campaign.bump,
        has_one = authority @ CampaignError::Unauthorized,
        constraint = campaign.is_active @ CampaignError::CampaignNotActive,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

impl<'info> CloseCampaign<'info> {
    pub fn close_campaign(&mut self) -> Result<()> {
        self.campaign.is_active = false;
        Ok(())
    }
}

pub fn handler(ctx: Context<CloseCampaign>) -> Result<()> {
    ctx.accounts.close_campaign()
}