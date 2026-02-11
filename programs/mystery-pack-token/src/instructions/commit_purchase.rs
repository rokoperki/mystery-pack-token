use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};
use switchboard_on_demand::accounts::RandomnessAccountData;

use crate::{
    FEE_PERCENTAGE, FEE_RECIPIENT, error::CampaignError, states::{Campaign, PurchaseRequest}
};

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CommitPurchase<'info> {
    #[account(
        mut,
        seeds = [b"campaign", campaign.seed.to_le_bytes().as_ref()],
        bump = campaign.bump,
        constraint = campaign.is_active @ CampaignError::CampaignNotActive,
        constraint = campaign.available_count() > 0 @ CampaignError::SoldOut,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        init,
        payer = buyer,
        space = 8 + PurchaseRequest::INIT_SPACE,
        seeds = [b"purchase_request", campaign.key().as_ref(), buyer.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump,
    )]
    pub purchase_request: Account<'info, PurchaseRequest>,

    /// CHECK: Validated by parsing with Switchboard SDK
    pub randomness_account: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump = campaign.vault_bump,
    )]
    pub sol_vault: SystemAccount<'info>,

    /// CHECK: Fee recipient address is validated against constant
    #[account(
        mut,
    )]
    pub fee_recipient: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> CommitPurchase<'info> {
    pub fn commit_purchase(&mut self, nonce: u64, bumps: &CommitPurchaseBumps) -> Result<()> {
        let randomness_data = RandomnessAccountData::parse(self.randomness_account.data.borrow())
            .map_err(|_| CampaignError::InvalidRandomnessAccount)?;

        let fee_amount = self.campaign.pack_price
            .checked_mul(FEE_PERCENTAGE)
            .and_then(|v| v.checked_div(100))
            .ok_or(CampaignError::InvalidAmount)?;

        let vault_amount = self.campaign.pack_price
            .checked_sub(fee_amount)
            .ok_or(CampaignError::InvalidAmount)?;

        transfer(
            CpiContext::new(
                self.system_program.to_account_info(),
                Transfer {
                    from: self.buyer.to_account_info(),
                    to: self.fee_recipient.to_account_info(),
                },
            ),
            fee_amount,
        )?;

        transfer(
            CpiContext::new(
                self.system_program.to_account_info(),
                Transfer {
                    from: self.buyer.to_account_info(),
                    to: self.sol_vault.to_account_info(),
                },
            ),
            vault_amount,
        )?;

        self.purchase_request.set_inner(PurchaseRequest {
            pack_index: None,
            campaign: self.campaign.key(),
            buyer: self.buyer.key(),
            commit_slot: randomness_data.seed_slot,
            randomness_account: self.randomness_account.key(),
            nonce,
            bump: bumps.purchase_request,
        });

        self.campaign.packs_committed += 1;

        Ok(())
    }
}

pub fn handler(ctx: Context<CommitPurchase>, nonce: u64) -> Result<()> {
    ctx.accounts.commit_purchase(nonce, &ctx.bumps)
}
