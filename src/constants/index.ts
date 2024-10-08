import { Address, BigInt, BigDecimal } from "@graphprotocol/graph-ts";

export const ADDRESS_ZERO = Address.fromString(
  "0x0000000000000000000000000000000000000000"
);

export const BIG_DECIMAL_1E6 = BigDecimal.fromString("1e6");
export const BIG_DECIMAL_1E10 = BigDecimal.fromString("1e10");
export const BIG_DECIMAL_1E12 = BigDecimal.fromString("1e12");
export const BIG_DECIMAL_1E18 = BigDecimal.fromString("1e18");
export const BIG_DECIMAL_ZERO = BigDecimal.fromString("0");
export const BIG_DECIMAL_ONE = BigDecimal.fromString("1");
export const BIG_DECIMAL_HUNDRED = BigDecimal.fromString("100");

export const BIG_INT_ONE = BigInt.fromI32(1);
export const BIG_INT_ZERO = BigInt.fromI32(0);
export const NULL_CALL_RESULT_VALUE =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

export const LBFACTORY_ADDRESS = Address.fromString('0x603764D0D819C50a6A9aab009410ABAC6482C874');

export const JOE_DEX_LENS_ADDRESS = Address.fromString('0x0A5077D8dc51e27Ad536847b0CF558165BA9AD1b');

export const JOE_DEX_LENS_USD_DECIMALS = BigDecimal.fromString("1e18");

export const WAVAX_ADDRESS = Address.fromString('0x69FE5cEC81D5eF92600c1A0dB1F11986AB3758Ab');
