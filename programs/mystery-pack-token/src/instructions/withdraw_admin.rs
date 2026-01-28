use crate::{error::CampaignError, states::Campaign};
use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

#[derive(Accounts)]
pub struct WithdrawAdmin<'info> {
    #[account(
        seeds = [b"campaign", campaign.seed.to_le_bytes().as_ref()],
        bump = campaign.bump,
        has_one = authority @ CampaignError::Unauthorized,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump = campaign.vault_bump,
    )]
    pub sol_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> WithdrawAdmin<'info> {
    pub fn withdraw(&self, amount: Option<u64>) -> Result<()> {
        let vault_balance = self.sol_vault.lamports();
        
        let withdraw_amount = amount.unwrap_or(vault_balance);
        
        require!(withdraw_amount <= vault_balance, CampaignError::InsufficientFunds);

        let campaign_key = self.campaign.key();
        let bump = [self.campaign.vault_bump];
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", campaign_key.as_ref(), &bump]];

        transfer(
            CpiContext::new_with_signer(
                self.system_program.to_account_info(),
                Transfer {
                    from: self.sol_vault.to_account_info(),
                    to: self.authority.to_account_info(),
                },
                signer_seeds,
            ),
            withdraw_amount,
        )
    }
}

pub fn handler(ctx: Context<WithdrawAdmin>, amount: Option<u64>) -> Result<()> {
    ctx.accounts.withdraw(amount)
}