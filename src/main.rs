use sha3::{Digest, Keccak256};
use rayon::prelude::*;
use std::env;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;

fn hex_to_bytes(s: &str) -> Vec<u8> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    hex::decode(s).expect("invalid hex address")
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: tempo-grinder <address_hex>");
        std::process::exit(1);
    }

    let address = hex_to_bytes(&args[1]);
    assert_eq!(address.len(), 20, "address must be 20 bytes");

    let found = AtomicBool::new(false);
    let total_attempts = AtomicU64::new(0);
    let start = Instant::now();

    let num_threads = rayon::current_num_threads();
    eprintln!("Grinding with {} threads...", num_threads);

    let result = (0..num_threads).into_par_iter().find_map_any(|thread_id| {
        let mut rng_state: u64 = 0x9E3779B97F4A7C15u64.wrapping_add(thread_id as u64 * 0xBF58476D1CE4E5B9);
        let mut salt = [0u8; 32];

        // seed salt bytes from a simple xorshift RNG, distinct per thread
        for chunk in salt.chunks_mut(8) {
            rng_state ^= rng_state << 13;
            rng_state ^= rng_state >> 7;
            rng_state ^= rng_state << 17;
            chunk.copy_from_slice(&rng_state.to_le_bytes()[..chunk.len()]);
        }

        let mut local_attempts: u64 = 0;

        loop {
            if found.load(Ordering::Relaxed) {
                return None;
            }

            // increment salt (walk forward deterministically from the random start)
            for byte in salt.iter_mut().rev() {
                *byte = byte.wrapping_add(1);
                if *byte != 0 {
                    break;
                }
            }

            let mut hasher = Keccak256::new();
            hasher.update(&address);
            hasher.update(&salt);
            let digest = hasher.finalize();

            local_attempts += 1;

            if digest[0] == 0 && digest[1] == 0 && digest[2] == 0 && digest[3] == 0 {
                found.store(true, Ordering::Relaxed);
                let total = total_attempts.fetch_add(local_attempts, Ordering::Relaxed) + local_attempts;
                let elapsed = start.elapsed().as_secs_f64();
                return Some((salt, digest, total, elapsed));
            }

            if local_attempts % 2_000_000 == 0 {
                let total = total_attempts.fetch_add(2_000_000, Ordering::Relaxed) + 2_000_000;
                if thread_id == 0 {
                    let elapsed = start.elapsed().as_secs_f64();
                    eprintln!(
                        "~{} attempts, {:.0}/sec, {:.0}s elapsed",
                        total,
                        total as f64 / elapsed,
                        elapsed
                    );
                }
            }
        }
    });

    match result {
        Some((salt, digest, total, elapsed)) => {
            println!("FOUND");
            println!("salt: 0x{}", hex::encode(salt));
            println!("masterId: 0x{}", hex::encode(&digest[4..8]));
            println!("attempts: {}", total);
            println!("elapsed_sec: {:.1}", elapsed);
            println!("rate: {:.0}/sec", total as f64 / elapsed);
        }
        None => {
            eprintln!("No result (unexpected)");
        }
    }
}
