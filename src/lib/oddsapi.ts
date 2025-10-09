const SPORT_MAP: Record<string,string> = {
  nfl: 'americanfootball_nfl',
  nba: 'basketball_nba',
  nhl: 'icehockey_nhl',
  ncaaf: 'americanfootball_ncaaf',
};

export function sportKey(s: string) {
  const k = SPORT_MAP[s];
  if (!k) throw new Error('Unsupported sport');
  return k;
}

export const ODDS_BASE = 'https://api.the-odds-api.com/v4';
export const ODDS_KEY = process.env.ODDS_API_KEY!;
export const ODDS_BOOKMAKERS = process.env.PRIMARY_BOOKMAKER || 'betmgm';
