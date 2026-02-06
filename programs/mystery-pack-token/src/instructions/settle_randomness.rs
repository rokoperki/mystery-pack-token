use anchor_lang::prelude::*;
use switchboard_on_demand::accounts::RandomnessAccountData;

use crate::{
    error::CampaignError,
    states::{Campaign, PurchaseRequest, Receipt},
};

#[derive(Accounts)]
pub struct SettleRandomness<'info> {
    #[account(
        mut,
        seeds = [b"campaign", campaign.seed.to_le_bytes().as_ref()],
        bump = campaign.bump,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        close = buyer,
        seeds = [b"purchase_request", campaign.key().as_ref(), buyer.key().as_ref(), purchase_request.nonce.to_le_bytes().as_ref()],
        bump = purchase_request.bump,
        constraint = purchase_request.campaign == campaign.key() @ CampaignError::Unauthorized,
        constraint = purchase_request.buyer == buyer.key() @ CampaignError::Unauthorized,
        constraint = purchase_request.pack_index.is_none() @ CampaignError::AlreadySettled,
    )]
    pub purchase_request: Account<'info, PurchaseRequest>,

    /// CHECK: Validated by parsing with Switchboard SDK
    #[account(
        constraint = randomness_account.key() == purchase_request.randomness_account @ CampaignError::InvalidRandomnessAccount,
    )]
    pub randomness_account: UncheckedAccount<'info>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        init,
        payer = buyer,
        space = 8 + Receipt::INIT_SPACE,
        seeds = [b"receipt", campaign.key().as_ref(), buyer.key().as_ref(), purchase_request.nonce.to_le_bytes().as_ref()],
        bump,
    )]
    pub receipt: Account<'info, Receipt>,

    pub system_program: Program<'info, System>,
}

impl<'info> SettleRandomness<'info> {
    pub fn settle_randomness(&mut self) -> Result<()> {
        let randomness_data = RandomnessAccountData::parse(
            self.randomness_account.data.borrow()
        ).map_err(|_| CampaignError::InvalidRandomnessAccount)?;

        require!(
            randomness_data.seed_slot == self.purchase_request.commit_slot,
            CampaignError::RandomnessSlotMismatch
        );

        let clock = Clock::get()?;
        let revealed_random_value = randomness_data
            .get_value(clock.slot)
            .map_err(|_| CampaignError::RandomnessNotReady)?;

        let available_count = self.campaign.available_count();
        require!(available_count > 0, CampaignError::SoldOut);

        let random_bytes: [u8; 8] = revealed_random_value[0..8]
            .try_into()
            .unwrap();
        let random_value = u64::from_le_bytes(random_bytes);
        let random_index = (random_value % available_count as u64) as u32;

        let pack_index = self.campaign
            .get_nth_available(random_index)
            .ok_or(CampaignError::NoPacksAvailable)?;

        self.campaign.mark_pack_taken(pack_index);

        self.campaign.packs_committed = self.campaign.packs_committed.saturating_sub(1);
        self.campaign.packs_sold += 1;

        self.receipt.set_inner(Receipt {
            campaign: self.campaign.key(),
            buyer: self.buyer.key(),
            pack_index,
            nonce: self.purchase_request.nonce,
            is_claimed: false,
        });

        msg!("Pack {} assigned to buyer {}", pack_index, self.buyer.key());

        Ok(())
    }
}

pub fn handler(ctx: Context<SettleRandomness>) -> Result<()> {
    ctx.accounts.settle_randomness()
}