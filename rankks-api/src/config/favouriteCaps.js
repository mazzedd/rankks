// Free-tier favourite caps. Bypassed entirely for any subscription_tier != 'free'.
module.exports = {
  FAVOURITE_CAPS: {
    competition: 5,
    athleteClub: 10, // combined pool: entity_type IN ('athlete', 'club')
    media: 20,
  },
};
