use anchor_lang::{prelude::*, system_program::{transfer, Transfer}};

use crate::{error::CampaignError, states::{Campaign, Receipt}};

#[derive(Accounts)]
pub struct PurchasePack<'info> {
    #[account(
        mut,
        seeds = [b"campaign", campaign.seed.to_le_bytes().as_ref()],
        bump = campaign.bump,
        constraint = campaign.is_active @ CampaignError::CampaignNotActive,
        constraint = campaign.packs_sold < campaign.total_packs @ CampaignError::SoldOut,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        init,
        payer = buyer,
        space = 8 + Receipt::INIT_SPACE,
        seeds = [b"receipt", campaign.key().as_ref(), &campaign.packs_sold.to_le_bytes()],
        bump,
    )]
    pub receipt: Account<'info, Receipt>,

    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump = campaign.vault_bump,
    )]
    pub sol_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> PurchasePack<'info> {
    pub fn purchase_pack(&mut self) -> Result<()> {
        transfer(
            CpiContext::new(
                self.system_program.to_account_info(),
                Transfer {
                    from: self.buyer.to_account_info(),
                    to: self.sol_vault.to_account_info(),
                },
            ),
            self.campaign.pack_price,
        )?;

        self.receipt.set_inner(Receipt {
            campaign: self.campaign.key(),
            buyer: self.buyer.key(),
            pack_index: self.campaign.packs_sold,
            is_claimed: false,
        });

        self.campaign.packs_sold += 1;

        Ok(())
    }
}

pub fn handler(ctx: Context<PurchasePack>) -> Result<()> {
    ctx.accounts.purchase_pack()
}