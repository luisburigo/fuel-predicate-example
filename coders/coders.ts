import { type BytesLike, hexlify, arrayify } from 'fuels';
import { BakoCoders } from './coder';
import { splitSignature } from '@ethersproject/bytes';
import { hexToBytes } from '@ethereumjs/util';

export enum SignatureType {
  Fuel = 0,
  EVM = 1,
}

export type FuelInput = {
  type: SignatureType.Fuel;
  signature: BytesLike;
};

export type EVMInput = {
  type: SignatureType.EVM;
  signature: BytesLike;
};

export const bakoCoder = new BakoCoders<
  SignatureType,
  FuelInput | EVMInput
>();

bakoCoder.addCoder(SignatureType.Fuel, (data) => {
  return hexlify(arrayify(data.signature));
});

bakoCoder.addCoder(SignatureType.EVM, (data) => {
  return splitSignature(hexToBytes(hexlify(data.signature))).compact;
});
