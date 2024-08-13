// Tick field is yet to be added

import { Address, BigDecimal, BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import {
  Swap as SwapEvent,
  FlashLoan,
  DepositedToBins,
  // CompositionFee,
  // WithdrawnFromBin,
  // FeesCollected,
  // ProtocolFeesCollected,
  // TransferSingle,
  TransferBatch,
} from "../generated/LBPair/LBPair";
import {
  Token,
  LBPair,
  Swap,
  Flash,
  Collect,
  Transfer,
  LBPairParameterSet,
} from "../generated/schema";
import {
  loadBin,
  loadLbPair,
  loadToken,
  loadBundle,
  loadLBFactory,
  loadTraderJoeHourData,
  loadTraderJoeDayData,
  loadTokenHourData,
  loadTokenDayData,
  loadSJoeDayData,
  loadUser,
  loadLBPairDayData,
  loadLBPairHourData,
  addLiquidityPosition,
  removeLiquidityPosition,
  loadTransaction,
  trackBin,
  updateUserClaimedFeesData,
  updateUserAccruedFeesDataSingleToken,
  updateUserAccruedFeesDataBothTokens,
} from "./entities";
import {
  BIG_INT_ONE,
  BIG_DECIMAL_ZERO,
  BIG_INT_ZERO,
  ADDRESS_ZERO,
} from "./constants";
import {
  formatTokenAmountByDecimals,
  getTrackedLiquidityUSD,
  getTrackedVolumeUSD,
  updateAvaxInUsdPricing,
  updateTokensDerivedAvax,
  safeDiv,
} from "./utils";
import { WithdrawnFromBins } from "../generated/LBFactory/LBPair";

// old event
// event Swap(
//   address indexed sender,
//   address indexed recipient,
//   uint256 indexed id,
//   bool swapForY,
//   uint256 amountIn,
//   uint256 amountOut,
//   uint256 volatilityAccumulated,
//   uint256 fees
// );


// new event
// event Swap(
//   address indexed sender,
//   address indexed to,
//   uint24 id,
//   bytes32 amountsIn,
//   bytes32 amountsOut,
//   uint24 volatilityAccumulator,
//   bytes32 totalFees,
//   bytes32 protocolFees
// );

export function handleSwap(event: SwapEvent): void {
  log.error("handleSwap: {}", [event.address.toHexString()]);
  const lbPair = loadLbPair(event.address);

  if (!lbPair) {
    log.warning("[handleSwap] LBPair not detected: {} ", [
      event.address.toHexString(),
    ]);
    return;
  }

  // update pricing
  updateAvaxInUsdPricing();
  updateTokensDerivedAvax(lbPair, BigInt.fromI32(event.params.id));

  // price bundle
  const bundle = loadBundle();

  // reset tvl aggregates until new amounts calculated
  const lbFactory = loadLBFactory();
  lbFactory.totalValueLockedAVAX = lbFactory.totalValueLockedAVAX.minus(
    lbPair.totalValueLockedAVAX
  );

  const tokenX = loadToken(Address.fromString(lbPair.tokenX));
  const tokenY = loadToken(Address.fromString(lbPair.tokenY));
  const tokenXPriceUSD = tokenX.derivedAVAX.times(bundle.avaxPriceUSD);
  const tokenYPriceUSD = tokenY.derivedAVAX.times(bundle.avaxPriceUSD);


  event.params.amountsIn.reverse()
  event.params.amountsOut.reverse()
  event.params.totalFees.reverse()
  event.params.protocolFees.reverse()

  const decodedAmountInX = decodeX(event.params.amountsIn)
  const decodedAmountInY = decodeY(event.params.amountsIn)
  const decodedAmountOutX = decodeX(event.params.amountsOut)
  const decodedAmountOutY = decodeY(event.params.amountsOut)

  const decodedTotalFeesX = decodeX(event.params.totalFees)
  const decodedTotalFeesY = decodeY(event.params.totalFees)

  const decodedProtocolFeesX = decodeX(event.params.protocolFees)
  const decodedProtocolFeesY = decodeY(event.params.protocolFees)

  const amountXIn = formatTokenAmountByDecimals(
    decodedAmountInX,
    tokenX.decimals
  );
  const amountXOut = formatTokenAmountByDecimals(
    decodedAmountOutX,
    tokenX.decimals
  );

  const amountYIn = formatTokenAmountByDecimals(
    decodedAmountInY,
    tokenY.decimals
  );
  const amountYOut = formatTokenAmountByDecimals(
    decodedAmountOutY,
    tokenY.decimals
  );

  const amountXTotal = amountXIn.plus(amountXOut);
  const amountYTotal = amountYIn.plus(amountYOut);

  const feesX = formatTokenAmountByDecimals(decodedTotalFeesX, tokenX.decimals);
  const feesY = formatTokenAmountByDecimals(decodedTotalFeesY, tokenY.decimals);
  // const fees = formatTokenAmountByDecimals(event.params.fees, tokenIn.decimals);
  // const feesUSD = fees.times(tokenIn.derivedAVAX.times(bundle.avaxPriceUSD));

  const trackedVolumeUSD = getTrackedVolumeUSD(
    amountXTotal,
    tokenX as Token,
    amountYTotal,
    tokenY as Token
  );
  const trackedVolumeAVAX = safeDiv(trackedVolumeUSD, bundle.avaxPriceUSD);

  const id = BigInt.fromI32(event.params.id);

  // Bin
  const bin = trackBin(
    lbPair as LBPair,
    id,
    amountXIn,
    amountXOut,
    amountYIn,
    amountYOut,
    BIG_INT_ZERO,
    BIG_INT_ZERO
  );

  // LBPair
  lbPair.activeId = id;
  lbPair.txCount = lbPair.txCount.plus(BIG_INT_ONE);
  lbPair.reserveX = lbPair.reserveX.plus(amountXIn).minus(amountXOut);
  lbPair.reserveY = lbPair.reserveY.plus(amountYIn).minus(amountYOut);
  lbPair.totalValueLockedUSD = getTrackedLiquidityUSD(
    lbPair.reserveX,
    tokenX as Token,
    lbPair.reserveY,
    tokenY as Token
  );
  lbPair.totalValueLockedAVAX = safeDiv(
    lbPair.totalValueLockedUSD,
    bundle.avaxPriceUSD
  );
  lbPair.tokenXPrice = bin.priceX;
  lbPair.tokenYPrice = bin.priceY;
  lbPair.volumeTokenX = lbPair.volumeTokenX.plus(amountXTotal);
  lbPair.volumeTokenY = lbPair.volumeTokenY.plus(amountYTotal);
  lbPair.volumeUSD = lbPair.volumeUSD.plus(trackedVolumeUSD);

  lbPair.feesTokenX = lbPair.feesTokenX.plus(feesX);
  lbPair.feesTokenY = lbPair.feesTokenY.plus(feesY);
  // lbPair.feesUSD = lbPair.feesUSD.plus(feesUSD);
  lbPair.save();

  // LBPairHourData
  const lbPairHourData = loadLBPairHourData(
    event.block.timestamp,
    lbPair as LBPair,
    true
  );
  lbPairHourData.volumeTokenX = lbPairHourData.volumeTokenX.plus(amountXTotal);
  lbPairHourData.volumeTokenY = lbPairHourData.volumeTokenY.plus(amountYTotal);
  lbPairHourData.volumeUSD = lbPairHourData.volumeUSD.plus(trackedVolumeUSD);
  // lbPairHourData.feesUSD = lbPairHourData.feesUSD.plus(feesUSD);
  lbPairHourData.save();

  // LBPairDayData
  const lbPairDayData = loadLBPairDayData(
    event.block.timestamp,
    lbPair as LBPair,
    true
  );
  lbPairDayData.volumeTokenX = lbPairDayData.volumeTokenX.plus(amountXTotal);
  lbPairDayData.volumeTokenY = lbPairDayData.volumeTokenY.plus(amountYTotal);
  lbPairDayData.volumeUSD = lbPairDayData.volumeUSD.plus(trackedVolumeUSD);
  // lbPairDayData.feesUSD = lbPairDayData.feesUSD.plus(feesUSD);
  lbPairDayData.save();

  // LBFactory
  lbFactory.txCount = lbFactory.txCount.plus(BIG_INT_ONE);
  lbFactory.volumeUSD = lbFactory.volumeUSD.plus(trackedVolumeUSD);
  lbFactory.volumeAVAX = lbFactory.volumeAVAX.plus(trackedVolumeAVAX);
  lbFactory.totalValueLockedAVAX = lbFactory.totalValueLockedAVAX.plus(
    lbPair.totalValueLockedAVAX
  );
  lbFactory.totalValueLockedUSD = lbFactory.totalValueLockedAVAX.times(
    bundle.avaxPriceUSD
  );
  // lbFactory.feesUSD = lbFactory.feesUSD.plus(feesUSD);
  lbFactory.feesAVAX = safeDiv(lbFactory.feesUSD, bundle.avaxPriceUSD);
  lbFactory.save();

  // TraderJoeHourData
  const traderJoeHourData = loadTraderJoeHourData(event.block.timestamp, true);
  traderJoeHourData.volumeAVAX = traderJoeHourData.volumeAVAX.plus(
    trackedVolumeAVAX
  );
  traderJoeHourData.volumeUSD = traderJoeHourData.volumeUSD.plus(
    trackedVolumeUSD
  );
  // traderJoeHourData.feesUSD = traderJoeHourData.feesUSD.plus(feesUSD);
  traderJoeHourData.save();

  // TraderJoeDayData
  const traderJoeDayData = loadTraderJoeDayData(event.block.timestamp, true);
  traderJoeDayData.volumeAVAX = traderJoeDayData.volumeAVAX.plus(
    trackedVolumeAVAX
  );
  traderJoeDayData.volumeUSD = traderJoeDayData.volumeUSD.plus(
    trackedVolumeUSD
  );
  // traderJoeDayData.feesUSD = traderJoeDayData.feesUSD.plus(feesUSD);
  traderJoeDayData.save();

  // TokenX
  tokenX.txCount = tokenX.txCount.plus(BIG_INT_ONE);
  tokenX.volume = tokenX.volume.plus(amountXTotal);
  tokenX.volumeUSD = tokenX.volumeUSD.plus(trackedVolumeUSD);
  tokenX.totalValueLocked = tokenX.totalValueLocked
    .plus(amountXIn)
    .minus(amountXOut);
  tokenX.totalValueLockedUSD = tokenX.totalValueLockedUSD.plus(
    tokenX.totalValueLocked.times(tokenXPriceUSD)
  );
  // if (swapForY) {
  //   tokenX.feesUSD = tokenX.feesUSD.plus(fees.times(tokenXPriceUSD));
  // }

  // TokenY
  tokenY.txCount = tokenY.txCount.plus(BIG_INT_ONE);
  tokenY.volume = tokenY.volume.plus(amountYTotal);
  tokenY.volumeUSD = tokenY.volumeUSD.plus(trackedVolumeUSD);
  tokenY.totalValueLocked = tokenY.totalValueLocked
    .plus(amountYIn)
    .minus(amountYOut);
  tokenY.totalValueLockedUSD = tokenY.totalValueLockedUSD.plus(
    tokenY.totalValueLocked.times(tokenYPriceUSD)
  );
  // if (!swapForY) {
  //   tokenY.feesUSD = tokenY.feesUSD.plus(fees.times(tokenYPriceUSD));
  // }

  tokenX.save();
  tokenY.save();

  // TokenXHourData
  const tokenXHourData = loadTokenHourData(
    event.block.timestamp,
    tokenX as Token,
    true
  );
  tokenXHourData.volume = tokenXHourData.volume.plus(amountXTotal);
  tokenXHourData.volumeAVAX = tokenXHourData.volumeAVAX.plus(trackedVolumeAVAX);
  tokenXHourData.volumeUSD = tokenXHourData.volumeUSD.plus(trackedVolumeUSD);
  // if (swapForY) {
  //   tokenXHourData.feesUSD = tokenXHourData.feesUSD.plus(feesUSD);
  // }
  tokenXHourData.save();

  // TokenYHourData
  const tokenYHourData = loadTokenHourData(
    event.block.timestamp,
    tokenY as Token,
    true
  );
  tokenYHourData.volume = tokenYHourData.volume.plus(amountYTotal);
  tokenYHourData.volumeAVAX = tokenYHourData.volumeAVAX.plus(trackedVolumeAVAX);
  tokenYHourData.volumeUSD = tokenYHourData.volumeUSD.plus(trackedVolumeUSD);
  // if (!swapForY) {
  //   tokenYHourData.feesUSD = tokenYHourData.feesUSD.plus(feesUSD);
  // }
  tokenYHourData.save();

  // TokenXDayData
  const tokenXDayData = loadTokenDayData(
    event.block.timestamp,
    tokenX as Token,
    true
  );
  tokenXDayData.volume = tokenXDayData.volume.plus(amountXTotal);
  tokenXDayData.volumeAVAX = tokenXDayData.volumeAVAX.plus(trackedVolumeAVAX);
  tokenXDayData.volumeUSD = tokenXDayData.volumeUSD.plus(trackedVolumeUSD);
  // if (swapForY) {
  //   tokenXDayData.feesUSD = tokenXDayData.feesUSD.plus(feesUSD);
  // }
  tokenXDayData.save();

  // TokenYDayData
  const tokenYDayData = loadTokenDayData(
    event.block.timestamp,
    tokenY as Token,
    true
  );
  tokenYDayData.volume = tokenYDayData.volume.plus(amountYTotal);
  tokenYDayData.volumeAVAX = tokenYDayData.volumeAVAX.plus(trackedVolumeAVAX);
  tokenYDayData.volumeUSD = tokenYDayData.volumeUSD.plus(trackedVolumeUSD);
  // if (!swapForY) {
  //   tokenYDayData.feesUSD = tokenYDayData.feesUSD.plus(feesUSD);
  // }
  tokenYDayData.save();

  // // update users accrued fees
  // const lbPairFeeParams = LBPairParameterSet.load(lbPair.id);
  // if (lbPairFeeParams) {
  //   const protocolSharePct = lbPairFeeParams.protocolSharePct;
  //   updateUserAccruedFeesDataSingleToken(
  //     lbPair,
  //     bin,
  //     fees,
  //     protocolSharePct,
  //     swapForY,
  //     event.block.timestamp
  //   );
  // }

  // User
  loadUser(event.params.to);

  // Transaction
  const transaction = loadTransaction(event);

  // Swap
  const swap = new Swap(
    transaction.id.concat("#").concat(lbPair.txCount.toString())
  );
  swap.transaction = transaction.id;
  swap.timestamp = event.block.timestamp.toI32();
  swap.lbPair = lbPair.id;
  swap.sender = event.params.sender;
  swap.recipient = event.params.to;
  swap.origin = event.transaction.from;
  swap.activeId = id;
  swap.amountXIn = amountXIn;
  swap.amountXOut = amountXOut;
  swap.amountYIn = amountYIn;
  swap.amountYOut = amountYOut;
  swap.amountUSD = trackedVolumeUSD;
  swap.feesTokenX = feesX;
  swap.feesTokenY = feesY;
  // swap.feesUSD = feesUSD;
  swap.feesUSD = BIG_DECIMAL_ZERO;
  swap.logIndex = event.logIndex;
  swap.save();
}

export function handleFlashLoan(event: FlashLoan): void {
  // const lbPair = loadLbPair(event.address);

  // if (!lbPair) {
  //   return;
  // }

  // // update pricing
  // updateAvaxInUsdPricing();
  // updateTokensDerivedAvax(lbPair, null);

  // // price bundle
  // const bundle = loadBundle();

  // const tokenX = loadToken(Address.fromString(lbPair.tokenX));
  // const tokenY = loadToken(Address.fromString(lbPair.tokenY));

  // const isTokenX = Address.fromString(lbPair.tokenX).equals(event.params.token);
  // const token = isTokenX ? tokenX : tokenY;

  // const amount = formatTokenAmountByDecimals(
  //   event.params.amount,
  //   token.decimals
  // );
  // const fees = formatTokenAmountByDecimals(event.params.fee, token.decimals);
  // const feesUSD = fees.times(token.derivedAVAX.times(bundle.avaxPriceUSD));

  // const lbFactory = loadLBFactory();
  // lbFactory.txCount = lbFactory.txCount.plus(BIG_INT_ONE);
  // lbFactory.feesUSD = lbFactory.feesUSD.plus(feesUSD);
  // lbFactory.feesAVAX = safeDiv(lbFactory.feesUSD, bundle.avaxPriceUSD);
  // lbFactory.save();

  // const traderJoeHourData = loadTraderJoeHourData(event.block.timestamp, true);
  // traderJoeHourData.feesUSD = traderJoeHourData.feesUSD.plus(feesUSD);
  // traderJoeHourData.save();

  // const traderJoeDayData = loadTraderJoeDayData(event.block.timestamp, true);
  // traderJoeDayData.feesUSD = traderJoeDayData.feesUSD.plus(feesUSD);
  // traderJoeDayData.save();

  // const tokenHourData = loadTokenHourData(
  //   event.block.timestamp,
  //   token as Token,
  //   true
  // );
  // const tokenDayData = loadTokenDayData(
  //   event.block.timestamp,
  //   token as Token,
  //   true
  // );
  // if (event.params.amount.gt(BIG_INT_ZERO)) {
  //   token.txCount = token.txCount.plus(BIG_INT_ONE);
  // } else {
  //   tokenHourData.txCount = tokenHourData.txCount.minus(BIG_INT_ONE);
  //   tokenDayData.txCount = tokenDayData.txCount.minus(BIG_INT_ONE);
  // }
  // token.feesUSD = token.feesUSD.plus(feesUSD);
  // tokenHourData.feesUSD = tokenHourData.feesUSD.plus(feesUSD);
  // tokenDayData.feesUSD = tokenDayData.feesUSD.plus(feesUSD);
  // token.save();
  // tokenHourData.save();
  // tokenDayData.save();

  // lbPair.txCount = lbPair.txCount.plus(BIG_INT_ONE);
  // if (isTokenX) {
  //   lbPair.feesTokenX = lbPair.feesTokenX.plus(fees);
  // } else {
  //   lbPair.feesTokenY = lbPair.feesTokenY.plus(fees);
  // }
  // lbPair.feesUSD = lbPair.feesUSD.plus(feesUSD);
  // lbPair.save();

  // const lbPairHourData = loadLBPairHourData(
  //   event.block.timestamp,
  //   lbPair as LBPair,
  //   true
  // );
  // lbPairHourData.feesUSD = lbPairHourData.feesUSD.plus(feesUSD);
  // lbPairHourData.save();

  // const lbPairDayData = loadLBPairDayData(
  //   event.block.timestamp,
  //   lbPair as LBPair,
  //   true
  // );
  // lbPairDayData.feesUSD = lbPairDayData.feesUSD.plus(feesUSD);
  // lbPairDayData.save();

  // // update users accrued fees
  // const bin = loadBin(lbPair, lbPair.activeId);
  // const lbPairFeeParams = LBPairParameterSet.load(lbPair.id);
  // if (lbPairFeeParams) {
  //   const protocolSharePct = lbPairFeeParams.protocolSharePct;
  //   updateUserAccruedFeesDataSingleToken(
  //     lbPair,
  //     bin,
  //     fees,
  //     protocolSharePct,
  //     isTokenX,
  //     event.block.timestamp
  //   );
  // }

  // const transaction = loadTransaction(event);

  // const flashloan = new Flash(
  //   transaction.id.concat("#").concat(lbPair.txCount.toString())
  // );
  // flashloan.transaction = transaction.id;
  // flashloan.timestamp = event.block.timestamp.toI32();
  // flashloan.lbPair = lbPair.id;
  // flashloan.sender = event.params.sender;
  // flashloan.recipient = event.params.receiver;
  // flashloan.origin = event.transaction.from;
  // flashloan.token = isTokenX ? tokenX.id : tokenY.id;
  // flashloan.amount = amount;
  // flashloan.amountUSD = isTokenX
  //   ? amount.times(tokenX.derivedAVAX.times(bundle.avaxPriceUSD))
  //   : amount.times(tokenY.derivedAVAX.times(bundle.avaxPriceUSD));
  // flashloan.fees = fees;
  // flashloan.feesUSD = feesUSD;
  // flashloan.logIndex = event.logIndex;
  // flashloan.save();
}

// export function handleCompositionFee(event: CompositionFee): void {
//   const lbPair = loadLbPair(event.address);

//   if (!lbPair) {
//     return;
//   }

//   // update pricing
//   updateAvaxInUsdPricing();
//   updateTokensDerivedAvax(lbPair, event.params.id);

//   // price bundle
//   const bundle = loadBundle();

//   const tokenX = loadToken(Address.fromString(lbPair.tokenX));
//   const tokenY = loadToken(Address.fromString(lbPair.tokenY));
//   const tokenXPriceUSD = tokenX.derivedAVAX.times(bundle.avaxPriceUSD);
//   const tokenYPriceUSD = tokenY.derivedAVAX.times(bundle.avaxPriceUSD);

//   const feesX = formatTokenAmountByDecimals(
//     event.params.feesX,
//     tokenX.decimals
//   );
//   const feesY = formatTokenAmountByDecimals(
//     event.params.feesY,
//     tokenY.decimals
//   );
//   const feesUSD = feesX
//     .times(tokenX.derivedAVAX.times(bundle.avaxPriceUSD))
//     .plus(feesY.times(tokenY.derivedAVAX.times(bundle.avaxPriceUSD)));

//   const lbFactory = loadLBFactory();
//   lbFactory.feesUSD = lbFactory.feesUSD.plus(feesUSD);
//   lbFactory.feesAVAX = safeDiv(lbFactory.feesUSD, bundle.avaxPriceUSD);
//   lbFactory.save();

//   const traderJoeHourData = loadTraderJoeHourData(event.block.timestamp, false);
//   traderJoeHourData.feesUSD = traderJoeHourData.feesUSD.plus(feesUSD);
//   traderJoeHourData.save();

//   const traderJoeDayData = loadTraderJoeDayData(event.block.timestamp, false);
//   traderJoeDayData.feesUSD = traderJoeDayData.feesUSD.plus(feesUSD);
//   traderJoeDayData.save();

//   tokenX.feesUSD = tokenX.feesUSD.plus(feesX.times(tokenXPriceUSD));
//   tokenX.save();

//   tokenY.feesUSD = tokenY.feesUSD.plus(feesY.times(tokenYPriceUSD));
//   tokenY.save();

//   const tokenXHourData = loadTokenHourData(
//     event.block.timestamp,
//     tokenX as Token,
//     false
//   );
//   tokenXHourData.feesUSD = tokenXHourData.feesUSD.plus(
//     feesX.times(tokenXPriceUSD)
//   );
//   tokenXHourData.save();

//   const tokenYHourData = loadTokenHourData(
//     event.block.timestamp,
//     tokenY as Token,
//     false
//   );
//   tokenYHourData.feesUSD = tokenYHourData.feesUSD.plus(
//     feesY.times(tokenYPriceUSD)
//   );
//   tokenYHourData.save();

//   const tokenXDayData = loadTokenDayData(
//     event.block.timestamp,
//     tokenX as Token,
//     false
//   );
//   tokenXDayData.feesUSD = tokenXDayData.feesUSD.plus(
//     feesX.times(tokenXPriceUSD)
//   );
//   tokenXDayData.save();

//   const tokenYDayData = loadTokenDayData(
//     event.block.timestamp,
//     tokenX as Token,
//     false
//   );
//   tokenYDayData.feesUSD = tokenYDayData.feesUSD.plus(
//     feesY.times(tokenYPriceUSD)
//   );
//   tokenYDayData.save();

//   lbPair.feesTokenX = lbPair.feesTokenX.plus(feesX);
//   lbPair.feesTokenY = lbPair.feesTokenY.plus(feesY);
//   lbPair.feesUSD = lbPair.feesUSD.plus(feesUSD);
//   lbPair.save();

//   const lbPairHourData = loadLBPairHourData(
//     event.block.timestamp,
//     lbPair as LBPair,
//     false
//   );
//   lbPairHourData.feesUSD = lbPairHourData.feesUSD.plus(feesUSD);
//   lbPairHourData.save();

//   const lbPairDayData = loadLBPairDayData(
//     event.block.timestamp,
//     lbPair as LBPair,
//     false
//   );
//   lbPairDayData.feesUSD = lbPairDayData.feesUSD.plus(feesUSD);
//   lbPairDayData.save();

//   // update users accrued fees
//   const bin = loadBin(lbPair, event.params.id);
//   const lbPairFeeParams = LBPairParameterSet.load(lbPair.id);
//   if (lbPairFeeParams) {
//     const protocolSharePct = lbPairFeeParams.protocolSharePct;
//     updateUserAccruedFeesDataBothTokens(
//       lbPair,
//       bin,
//       feesX,
//       feesY,
//       protocolSharePct,
//       event.block.timestamp
//     );
//   }
// }

export function handleLiquidityAdded(event: DepositedToBins): void {
  const lbPair = loadLbPair(event.address);
  const lbFactory = loadLBFactory();

  log.error("handleLiquidityAdded: {}", [event.address.toHexString()]);
  
  if (!lbPair) {
    log.error(
      "[handleLiquidityAdded] returning because LBPair not detected: {} ",
      [event.address.toHexString()]
    );
    return;
  }

  // update pricing
  updateAvaxInUsdPricing();

  // price bundle
  const bundle = loadBundle();

  const tokenX = loadToken(Address.fromString(lbPair.tokenX));
  const tokenY = loadToken(Address.fromString(lbPair.tokenY));

  // get amounts
  const amounts = event.params.amounts
  let decodedX = BigInt.zero()
  let decodedY = BigInt.zero()
  for (let i=0; i < amounts.length; i++) {
    const _amounts = amounts[i]
    // NOTE: reverse bytes to convert to big endianness
    amounts.reverse()
    const _amountX = decodeX(_amounts)
    const _amountY = decodeY(_amounts)
    decodedX = decodedX.plus(_amountX)
    decodedY = decodedY.plus(_amountY)

    const binAmountX = formatTokenAmountByDecimals(
      _amountX,
      tokenX.decimals
    );
    const binAmountY = formatTokenAmountByDecimals(
      _amountY,
      tokenY.decimals
    );

    // Bin
    trackBin(
      lbPair,
      event.params.ids[i],
      binAmountX, // amountXIn
      BIG_DECIMAL_ZERO,
      binAmountY, // amountYIn
      BIG_DECIMAL_ZERO,
      BIG_INT_ZERO,
      BIG_INT_ZERO
    );
  }

  const amountX = formatTokenAmountByDecimals(
    decodedX,
    tokenX.decimals
  );
  const amountY = formatTokenAmountByDecimals(
    decodedY,
    tokenY.decimals
  );

  // reset tvl aggregates until new amounts calculated
  lbFactory.totalValueLockedAVAX = lbFactory.totalValueLockedAVAX.minus(
    lbPair.totalValueLockedAVAX
  );

  // LBPair
  lbPair.txCount = lbPair.txCount.plus(BIG_INT_ONE);
  lbPair.reserveX = lbPair.reserveX.plus(amountX);
  lbPair.reserveY = lbPair.reserveY.plus(amountY);

  lbPair.totalValueLockedAVAX = lbPair.reserveX
    .times(tokenX.derivedAVAX)
    .plus(lbPair.reserveY.times(tokenY.derivedAVAX));
  lbPair.totalValueLockedUSD = lbPair.totalValueLockedAVAX.times(
    bundle.avaxPriceUSD
  );

  // get tracked liquidity - will be 0 if neither is in whitelist
  let trackedLiquidityAVAX: BigDecimal;
  if (bundle.avaxPriceUSD.notEqual(BIG_DECIMAL_ZERO)) {
    trackedLiquidityAVAX = safeDiv(
      getTrackedLiquidityUSD(
        lbPair.reserveX,
        tokenX as Token,
        lbPair.reserveY,
        tokenY as Token
      ),
      bundle.avaxPriceUSD
    );
  } else {
    trackedLiquidityAVAX = BIG_DECIMAL_ZERO;
  }
  lbPair.save();

  // LBFactory
  lbFactory.totalValueLockedAVAX = lbFactory.totalValueLockedAVAX.plus(
    lbPair.totalValueLockedAVAX
  );
  lbFactory.totalValueLockedUSD = lbFactory.totalValueLockedAVAX.times(
    bundle.avaxPriceUSD
  );
  lbFactory.txCount = lbFactory.txCount.plus(BIG_INT_ONE);
  lbFactory.save();

  loadLBPairHourData(event.block.timestamp, lbPair as LBPair, true);
  loadLBPairDayData(event.block.timestamp, lbPair as LBPair, true);
  loadTraderJoeHourData(event.block.timestamp, true);
  loadTraderJoeDayData(event.block.timestamp, true);

  // TokenX
  tokenX.txCount = tokenX.txCount.plus(BIG_INT_ONE);
  tokenX.totalValueLocked = tokenX.totalValueLocked.plus(amountX);
  tokenX.totalValueLockedUSD = tokenX.totalValueLocked.times(
    tokenX.derivedAVAX.times(bundle.avaxPriceUSD)
  );
  tokenX.save();

  // TokenY
  tokenY.txCount = tokenY.txCount.plus(BIG_INT_ONE);
  tokenY.totalValueLocked = tokenY.totalValueLocked.plus(amountY);
  tokenY.totalValueLockedUSD = tokenY.totalValueLocked.times(
    tokenY.derivedAVAX.times(bundle.avaxPriceUSD)
  );
  tokenY.save();

  loadTokenHourData(event.block.timestamp, tokenX as Token, true);
  loadTokenHourData(event.block.timestamp, tokenY as Token, true);
  loadTokenDayData(event.block.timestamp, tokenX as Token, true);
  loadTokenDayData(event.block.timestamp, tokenY as Token, true);

  // User
  loadUser(event.params.to);
}

export function handleLiquidityRemoved(event: WithdrawnFromBins): void {
  const lbPair = loadLbPair(event.address);
  const lbFactory = loadLBFactory();

  log.error("handleLiquidityRemoved: {}", [event.address.toHexString()]);

  if (!lbPair) {
    return;
  }

  // update pricing
  updateAvaxInUsdPricing();

  // price bundle
  const bundle = loadBundle();

  const tokenX = loadToken(Address.fromString(lbPair.tokenX));
  const tokenY = loadToken(Address.fromString(lbPair.tokenY));

  const amounts = event.params.amounts
  let decodedX = BigInt.zero()
  let decodedY = BigInt.zero()
  for (let i=0; i < amounts.length; i++) {
    updateTokensDerivedAvax(lbPair, event.params.ids[i]);

    const _amounts = amounts[i]
    // NOTE: reverse bytes to convert to big endianness
    amounts.reverse()
    const _amountX = decodeX(_amounts)
    const _amountY = decodeY(_amounts)
    decodedX = decodedX.plus(_amountX)
    decodedY = decodedY.plus(_amountY)

    const binAmountX = formatTokenAmountByDecimals(
      _amountX,
      tokenX.decimals
    );
    const binAmountY = formatTokenAmountByDecimals(
      _amountY,
      tokenY.decimals
    );

    // Bin
    trackBin(
      lbPair,
      event.params.ids[i],
      BIG_DECIMAL_ZERO,
      binAmountX, // amountXOut
      BIG_DECIMAL_ZERO,
      binAmountY, // amountYOut
      BIG_INT_ZERO,
      BIG_INT_ZERO
    );
  }

  const amountX = formatTokenAmountByDecimals(
    decodedX,
    tokenX.decimals
  );
  const amountY = formatTokenAmountByDecimals(
    decodedY,
    tokenY.decimals
  );

  // reset tvl aggregates until new amounts calculated
  lbFactory.totalValueLockedAVAX = lbFactory.totalValueLockedAVAX.minus(
    lbPair.totalValueLockedAVAX
  );

  // LBPair
  lbPair.txCount = lbPair.txCount.plus(BIG_INT_ONE);
  lbPair.reserveX = lbPair.reserveX.minus(amountX);
  lbPair.reserveY = lbPair.reserveY.minus(amountY);

  lbPair.totalValueLockedAVAX = lbPair.reserveX
    .times(tokenX.derivedAVAX)
    .plus(lbPair.reserveY.times(tokenY.derivedAVAX));
  lbPair.totalValueLockedUSD = lbPair.totalValueLockedAVAX.times(
    bundle.avaxPriceUSD
  );

  // get tracked liquidity - will be 0 if neither is in whitelist
  let trackedLiquidityAVAX: BigDecimal;
  if (bundle.avaxPriceUSD.notEqual(BIG_DECIMAL_ZERO)) {
    trackedLiquidityAVAX = safeDiv(
      getTrackedLiquidityUSD(
        lbPair.reserveX,
        tokenX as Token,
        lbPair.reserveY,
        tokenY as Token
      ),
      bundle.avaxPriceUSD
    );
  } else {
    trackedLiquidityAVAX = BIG_DECIMAL_ZERO;
  }
  lbPair.save();

  // LBFactory
  lbFactory.totalValueLockedAVAX = lbFactory.totalValueLockedAVAX.plus(
    lbPair.totalValueLockedAVAX
  );
  lbFactory.totalValueLockedUSD = lbFactory.totalValueLockedAVAX.times(
    bundle.avaxPriceUSD
  );
  lbFactory.txCount = lbFactory.txCount.plus(BIG_INT_ONE);
  lbFactory.save();

  loadLBPairHourData(event.block.timestamp, lbPair as LBPair, true);
  loadLBPairDayData(event.block.timestamp, lbPair as LBPair, true);
  loadTraderJoeHourData(event.block.timestamp, true);
  loadTraderJoeDayData(event.block.timestamp, true);

  // TokenX
  tokenX.txCount = tokenX.txCount.plus(BIG_INT_ONE);
  tokenX.totalValueLocked = tokenX.totalValueLocked.minus(amountX);
  tokenX.totalValueLockedUSD = tokenX.totalValueLocked.times(
    tokenX.derivedAVAX.times(bundle.avaxPriceUSD)
  );
  tokenX.save();

  // TokenY
  tokenY.txCount = tokenY.txCount.plus(BIG_INT_ONE);
  tokenY.totalValueLocked = tokenY.totalValueLocked.minus(amountY);
  tokenY.totalValueLockedUSD = tokenY.totalValueLocked.times(
    tokenY.derivedAVAX.times(bundle.avaxPriceUSD)
  );
  tokenY.save();

  loadTokenHourData(event.block.timestamp, tokenX as Token, true);
  loadTokenHourData(event.block.timestamp, tokenY as Token, true);
  loadTokenDayData(event.block.timestamp, tokenX as Token, true);
  loadTokenDayData(event.block.timestamp, tokenY as Token, true);

  // User
  loadUser(event.params.to);
}

// export function handleFeesCollected(event: FeesCollected): void {
//   const lbPair = loadLbPair(event.address);
//   if (!lbPair) {
//     return;
//   }

//   // update pricing
//   updateAvaxInUsdPricing();
//   updateTokensDerivedAvax(lbPair, null);

//   // price bundle
//   const bundle = loadBundle();

//   const user = loadUser(event.params.recipient);

//   const tokenX = loadToken(Address.fromString(lbPair.tokenX));
//   const tokenY = loadToken(Address.fromString(lbPair.tokenY));

//   const amountX = formatTokenAmountByDecimals(
//     event.params.amountX,
//     tokenX.decimals
//   );
//   const amountY = formatTokenAmountByDecimals(
//     event.params.amountY,
//     tokenY.decimals
//   );
//   const amountUSD = amountX
//     .times(tokenX.derivedAVAX.times(bundle.avaxPriceUSD))
//     .plus(amountY.times(tokenY.derivedAVAX.times(bundle.avaxPriceUSD)));

//   // update users claimed fees
//   updateUserClaimedFeesData(
//     lbPair,
//     user,
//     amountX,
//     amountY,
//     event.block.timestamp
//   );

//   const transaction = loadTransaction(event);
//   const feeCollected = new Collect(
//     transaction.id.concat("#").concat(lbPair.txCount.toString())
//   );
//   feeCollected.transaction = transaction.id;
//   feeCollected.timestamp = event.block.timestamp.toI32();

//   feeCollected.lbPair = lbPair.id;
//   feeCollected.amountX = amountX;
//   feeCollected.amountY = amountY;

//   feeCollected.recipient = user.id;
//   feeCollected.origin = event.transaction.from;
//   feeCollected.collectedUSD = amountUSD;
//   feeCollected.collectedAVAX = safeDiv(amountUSD, bundle.avaxPriceUSD);
//   feeCollected.logIndex = event.logIndex;

//   feeCollected.save();
// }

// export function handleProtocolFeesCollected(
//   event: ProtocolFeesCollected
// ): void {
//   // handle sJOE payout calculations here
//   // NOTE: this event will split amount recieved to multiple addresses
//   // - sJOE is just one of them so this mapping should be modified in future

//   const lbPair = loadLbPair(event.address);

//   if (!lbPair) {
//     return;
//   }

//   // update pricing
//   updateAvaxInUsdPricing();
//   updateTokensDerivedAvax(lbPair, null);

//   // price bundle
//   const bundle = loadBundle();

//   const tokenX = loadToken(Address.fromString(lbPair.tokenX));
//   const tokenY = loadToken(Address.fromString(lbPair.tokenY));

//   const amountX = formatTokenAmountByDecimals(
//     event.params.amountX,
//     tokenX.decimals
//   );
//   const amountY = formatTokenAmountByDecimals(
//     event.params.amountY,
//     tokenY.decimals
//   );
//   const derivedAmountAVAX = amountX
//     .times(tokenX.derivedAVAX)
//     .plus(amountY.times(tokenY.derivedAVAX));

//   const sJoeDayData = loadSJoeDayData(event.block.timestamp);
//   sJoeDayData.amountX = sJoeDayData.amountX.plus(amountX);
//   sJoeDayData.amountY = sJoeDayData.amountY.plus(amountY);
//   sJoeDayData.collectedAVAX = sJoeDayData.collectedAVAX.plus(derivedAmountAVAX);
//   sJoeDayData.collectedUSD = sJoeDayData.collectedUSD.plus(
//     derivedAmountAVAX.times(bundle.avaxPriceUSD)
//   );
//   sJoeDayData.save();
// }

// export function handleTransferSingle(event: TransferSingle): void {
//   const lbPair = loadLbPair(event.address);
//   if (!lbPair) {
//     return;
//   }

//   const lbFactory = loadLBFactory();
//   lbFactory.txCount = lbFactory.txCount.plus(BIG_INT_ONE);
//   lbFactory.save();

//   loadTraderJoeHourData(event.block.timestamp, true);
//   loadTraderJoeDayData(event.block.timestamp, true);

//   // update user liquidity position
//   removeLiquidityPosition(
//     event.address,
//     event.params.from,
//     event.params.id,
//     event.params.amount,
//     event.block
//   );
//   addLiquidityPosition(
//     event.address,
//     event.params.to,
//     event.params.id,
//     event.params.amount,
//     event.block
//   );

//   const isMint = ADDRESS_ZERO.equals(event.params.from);
//   const isBurn = ADDRESS_ZERO.equals(event.params.to);

//   // mint: increase bin totalSupply
//   if (isMint) {
//     trackBin(
//       lbPair,
//       event.params.id,
//       BIG_DECIMAL_ZERO,
//       BIG_DECIMAL_ZERO,
//       BIG_DECIMAL_ZERO,
//       BIG_DECIMAL_ZERO,
//       event.params.amount, // minted
//       BIG_INT_ZERO
//     );
//   }

//   // burn: decrease bin totalSupply
//   if (isBurn) {
//     trackBin(
//       lbPair,
//       event.params.id,
//       BIG_DECIMAL_ZERO,
//       BIG_DECIMAL_ZERO,
//       BIG_DECIMAL_ZERO,
//       BIG_DECIMAL_ZERO,
//       BIG_INT_ZERO,
//       event.params.amount // burned
//     );
//   }

//   loadLBPairDayData(event.block.timestamp, lbPair as LBPair, true);
//   loadLBPairHourData(event.block.timestamp, lbPair as LBPair, true);

//   lbPair.txCount = lbPair.txCount.plus(BIG_INT_ONE);
//   lbPair.save();

//   const transaction = loadTransaction(event);

//   const transfer = new Transfer(
//     transaction.id.concat("#").concat(lbPair.txCount.toString())
//   );
//   transfer.transaction = transaction.id;
//   transfer.timestamp = event.block.timestamp.toI32();
//   transfer.lbPair = lbPair.id;
//   transfer.isBatch = false;
//   transfer.isMint = isMint;
//   transfer.isBurn = isBurn;
//   transfer.binId = event.params.id;
//   transfer.amount = event.params.amount;
//   transfer.sender = event.params.sender;
//   transfer.from = event.params.from;
//   transfer.to = event.params.to;
//   transfer.origin = event.transaction.from;
//   transfer.logIndex = event.logIndex;

//   transfer.save();
// }

export function handleTransferBatch(event: TransferBatch): void {
  const lbPair = loadLbPair(event.address);
  if (!lbPair) {
    return;
  }

  lbPair.txCount = lbPair.txCount.plus(BIG_INT_ONE);
  lbPair.save();

  const lbFactory = loadLBFactory();
  lbFactory.txCount = lbFactory.txCount.plus(BIG_INT_ONE);
  lbFactory.save();

  loadTraderJoeHourData(event.block.timestamp, true);
  loadTraderJoeDayData(event.block.timestamp, true);
  loadLBPairDayData(event.block.timestamp, lbPair as LBPair, true);
  loadLBPairHourData(event.block.timestamp, lbPair as LBPair, true);

  const transaction = loadTransaction(event);

  for (let i = 0; i < event.params.amounts.length; i++) {
    removeLiquidityPosition(
      event.address,
      event.params.from,
      event.params.ids[i],
      event.params.amounts[i],
      event.block
    );
    addLiquidityPosition(
      event.address,
      event.params.to,
      event.params.ids[i],
      event.params.amounts[i],
      event.block
    );

    const isMint = ADDRESS_ZERO.equals(event.params.from);
    const isBurn = ADDRESS_ZERO.equals(event.params.to);

    // mint: increase bin totalSupply
    if (isMint) {
      trackBin(
        lbPair,
        event.params.ids[i],
        BIG_DECIMAL_ZERO,
        BIG_DECIMAL_ZERO,
        BIG_DECIMAL_ZERO,
        BIG_DECIMAL_ZERO,
        event.params.amounts[i], // minted
        BIG_INT_ZERO
      );
    }

    // burn: decrease bin totalSupply
    if (isBurn) {
      trackBin(
        lbPair,
        event.params.ids[i],
        BIG_DECIMAL_ZERO,
        BIG_DECIMAL_ZERO,
        BIG_DECIMAL_ZERO,
        BIG_DECIMAL_ZERO,
        BIG_INT_ZERO,
        event.params.amounts[i] // burned
      );
    }

    const transfer = new Transfer(
      transaction.id
        .concat("#")
        .concat(lbPair.txCount.toString())
        .concat("#")
        .concat(i.toString())
    );
    transfer.transaction = transaction.id;
    transfer.timestamp = event.block.timestamp.toI32();
    transfer.lbPair = lbPair.id;
    transfer.isBatch = true;
    transfer.batchIndex = i;
    transfer.isMint = isMint;
    transfer.isBurn = isBurn;
    transfer.binId = event.params.ids[i];
    transfer.amount = event.params.amounts[i];
    transfer.sender = event.params.sender;
    transfer.from = event.params.from;
    transfer.to = event.params.to;
    transfer.origin = event.transaction.from;
    transfer.logIndex = event.logIndex;

    transfer.save();
  }
}


// Assemblyscript API
// https://thegraph.com/docs/en/developing/assemblyscript-api/
function decodeX(packedAmounts: Bytes): BigInt {
  // Read the right 128 bits of the 256 bits
  return BigInt.fromUnsignedBytes(packedAmounts).bitAnd(BigInt.fromI32(2).pow(128).minus(BigInt.fromI32(1)))
}

function decodeY(packedAmounts: Bytes): BigInt {
  // Read the left 128 bits of the 256 bits
  return BigInt.fromUnsignedBytes(packedAmounts).rightShift(128)
}
