// save-customer, hand-written in Rust — the M2 exit-test body. It must be
// behaviorally identical to the action-IR twin on the drift corpus:
//   Validate name (non-empty) -> KvInsert customers -> Toast "Saved {name}"
// The capability imports are the contract's grants; this code physically
// cannot touch anything else.

#[allow(warnings)]
mod bindings;

use bindings::app::caps::kv_store;
use bindings::app::caps::toast;
use bindings::exports::app::customer::save_customer::{Guest, SaveCustomerInput};

struct Component;

impl Guest for Component {
    fn invoke(input: SaveCustomerInput) -> Result<(), String> {
        if input.name.trim().is_empty() {
            return Err("name is required".to_string());
        }
        kv_store::insert(
            "customers",
            &[
                ("name".to_string(), input.name.clone()),
                ("email".to_string(), input.email.clone()),
            ],
        )?;
        toast::show(&format!("Saved {}", input.name));
        Ok(())
    }
}

bindings::export!(Component with_types_in bindings);
