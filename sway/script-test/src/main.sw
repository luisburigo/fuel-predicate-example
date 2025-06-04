script;

use std::logging::log;

configurable {
    SECRET_NUMBER: u64 = 0
}

fn main(secret: u64) -> bool {
    log(SECRET_NUMBER);
    return secret == SECRET_NUMBER;
}
