export type MarketKey = 'h2h' | 'spreads' | 'totals';

export interface Outcome {
  name: string;
  price: number;         // moneyline or price
  point?: number;        // spread or total
}

export interface Market {
  key: MarketKey;
  outcomes: Outcome[];
}

export interface Bookmaker {
  key: string;
  markets: Market[];
}

export interface Game {
  id: string;
  commence_time: string;       // ISO
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
}
