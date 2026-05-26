export type Hex = `0x${string}`;
export type ChainName = 'base';
export type Asset = 'ETH' | 'USDC';
export type Pool = 'eth' | 'usdc';

export interface BaseCall {
  to: Hex;
  value: Hex;
  data: Hex;
}

export interface SendCallsPayload {
  chain: ChainName;
  calls: BaseCall[];
}

export interface StepCall extends BaseCall {
  step: string;
}

