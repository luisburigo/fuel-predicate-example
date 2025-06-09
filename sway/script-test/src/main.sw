script;

use std::ecr::ec_recover_address;
use std::{b512::B512, tx::{GTF_WITNESS_DATA, tx_id, tx_witnesses_count}};
use std::{
    crypto:: {
        signature::Signature,
        message::Message,
        public_key::PublicKey,
        secp256k1::Secp256k1
    },
    bytes::Bytes,
    tx::{
        tx_witness_data,
    },
    vm::evm::{
        evm_address::EvmAddress,
    },
};

/// Personal sign prefix for Ethereum inclusive of the 32 bytes for the length of the Tx ID.
///
/// # Additional Information
///
/// Take "\x19Ethereum Signed Message:\n64" and converted to hex.
/// The 00000000 at the end is the padding added by Sway to fill the word.
const ETHEREUM_PREFIX = 0x19457468657265756d205369676e6564204d6573736167653a0a363400000000;

struct SignedData {
    /// The id of the transaction to be signed.
    transaction_id: (b256, b256),
    /// EIP-191 personal sign prefix.
    ethereum_prefix: b256,
    /// Additional data used for reserving memory for hashing (hack).
    #[allow(dead_code)]
    empty: b256,
}

configurable {
    /// The Ethereum address that signed the transaction.
    SIGNER: [b256; 2] = [b256::zero(), b256::zero()],
}

pub struct Header {
    pub signature: B512,
}

enum SignatureType {
    FUEL: Header,
    EVM: Header,
}

enum SignatureAddress {
    FUEL: Address,
    EVM: EvmAddress,
}

pub const PREFIX_BAKO_SIG: [u8; 4] = [66, 65, 75, 79];

pub fn verify_prefix(witness_ptr: raw_ptr) -> bool {
    asm(
        prefix: PREFIX_BAKO_SIG,
        witness_ptr: witness_ptr,
        size: 4,
        r1,
    ) {
        meq r1 witness_ptr prefix size;
        r1: bool
    }
}

fn main() -> bool {
    let mut count = 0;

    let mut valid_signers = 0;

    while count < tx_witnesses_count() {
        let mut witness_ptr = __gtf::<raw_ptr>(count, GTF_WITNESS_DATA);

        if (verify_prefix(witness_ptr)) {
            let tx_bytes = b256_to_ascii_bytes2(tx_id());
            witness_ptr = witness_ptr.add_uint_offset(4); // skip bako prefix
            let signature = witness_ptr.read::<SignatureType>();
            witness_ptr = witness_ptr.add_uint_offset(__size_of::<u64>()); // skip enum size
            
            let witnesses_data = witness_ptr.read::<B512>();

            let address: SignatureAddress = match signature {
                SignatureType::FUEL(header) => {
                    let address = fuel_verify(witnesses_data, tx_bytes);
                    SignatureAddress::FUEL(address)
                },
                SignatureType::EVM(header) => {
                    let signature = Signature::Secp256k1(Secp256k1::from(witnesses_data));
                    let message = Message::from(personal_sign_hash(tx_id()));
                    let evm_address = signature.evm_address(message).unwrap_or(EvmAddress::from(INVALID_ADDRESS));
                    SignatureAddress::EVM(evm_address)
                },
                _ => {
                    return false;
                }
            };

            if check_signer_exists(address, SIGNER) {
                valid_signers += 1;
            }
        }

    }

    valid_signers == 2
}

pub fn check_signer_exists(
  signature_address: SignatureAddress,
  signers: [b256; 2],
) -> bool {
  let mut i = 0;

  while i < 2 {
    match signature_address {
      SignatureAddress::FUEL(address) => {
        if Address::from(signers[i]) == address {
          return true;
        }
      },
      SignatureAddress::EVM(address) => {
        if EvmAddress::from(signers[i]) == address {
          return true;
        }
      },
    }

    i += 1;
  }

  false
}

const ASCII_MAP: [u8; 16] = [
    48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 97, 98, 99, 100, 101, 102
];

pub const INVALID_ADDRESS: b256 = 0x0000000000000000000000000000000000000000000000000000000000000001;

pub fn hash_tx_id(value: Bytes) -> b256 {
  let mut digest = b256::zero();
  asm(value: value.ptr(), size: value.len(), r1: digest) {
    s256 r1 value size;
  };
  digest
}

pub fn fuel_verify(signature: B512, tx_bytes: Bytes) -> Address {
  let tx_fuel = hash_tx_id(tx_bytes);
  ec_recover_address(signature, tx_fuel).unwrap_or(Address::from(INVALID_ADDRESS))
}

pub fn b256_to_ascii_bytes2(val: b256) -> Bytes {
    let bytes = Bytes::from(val);
    let mut ascii_bytes = Bytes::with_capacity(64);
    let mut idx = 0;

    while idx < 32 {
        let b = bytes.get(idx).unwrap();
        ascii_bytes.push(ASCII_MAP[(b >> 4).as_u64()]);
        ascii_bytes.push(ASCII_MAP[(b & 15).as_u64()]);
	    idx = idx + 1;
    }

    ascii_bytes
}

fn b256_to_ascii_bytes(val: b256) -> (b256, b256) {
    let bytes = Bytes::from(val);
    let mut ascii_bytes = Bytes::with_capacity(64);
    let mut idx = 0;

    while idx < 32 {
        let b = bytes.get(idx).unwrap();
        ascii_bytes.push(ASCII_MAP[(b >> 4).as_u64()]);
        ascii_bytes.push(ASCII_MAP[(b & 15).as_u64()]);
	    idx = idx + 1;
    }

    asm(ptr: ascii_bytes.ptr()) {
        ptr: (b256, b256)
    }
}

/// Return the Keccak-256 hash of the transaction ID in the format of EIP-191.
///
/// # Arguments
///
/// * `transaction_id`: [b256] - Fuel Tx ID.
fn personal_sign_hash(transaction_id: b256) -> b256 {
    // Hack, allocate memory to reduce manual `asm` code.
    let transaction_id_utf8 = b256_to_ascii_bytes(transaction_id);
    let data = SignedData {
        transaction_id: transaction_id_utf8,
        ethereum_prefix: ETHEREUM_PREFIX,
        empty: b256::zero(),
    };

    // Pointer to the data we have signed external to Sway.
    let data_ptr = asm(ptr: data.transaction_id) {
        ptr
    };

    // The Ethereum prefix is 28 bytes (plus padding we exclude).
    // The Tx ID is 64 bytes at the end of the prefix.
    let len_to_hash = 28 + 64;

    // Create a buffer in memory to overwrite with the result being the hash.
    let mut buffer = b256::min();

    // Copy the Tx ID to the end of the prefix and hash the exact len of the prefix and id (without
    // the padding at the end because that would alter the hash).
    asm(
        hash: buffer,
        tx_id: data_ptr,
        end_of_prefix: data_ptr + len_to_hash,
        prefix: data.ethereum_prefix,
        id_len: 64,
        hash_len: len_to_hash,
    ) {
        mcp end_of_prefix tx_id id_len;
        k256 hash prefix hash_len;
    }

    // The buffer contains the hash.
    buffer
}