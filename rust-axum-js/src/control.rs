//! The checksum the gateway signs its 3DS callbacks with.
//! <https://doc.payneteasy.com/integration/API_commands/merchant_callback_parameters.html>

use sha1::{Digest as _, Sha1};
use subtle::ConstantTimeEq as _;

use crate::Params;

/// `sha1(status + orderid + merchant_order + MERCHANT_CONTROL)`, lowercase hex.
pub fn control_sum(
    status: &str,
    orderid: &str,
    merchant_order: &str,
    merchant_control: &str,
) -> String {
    let mut digest = Sha1::new();
    digest.update(status.as_bytes());
    digest.update(orderid.as_bytes());
    digest.update(merchant_order.as_bytes());
    digest.update(merchant_control.as_bytes());
    hex::encode(digest.finalize())
}

/// Whether a callback — or the query the payer carries on to `/result` — really came from the
/// gateway. Absent parameters count as empty strings, so an empty callback still has a
/// well-defined checksum rather than validating against a missing one.
pub fn valid_callback(params: &Params, merchant_control: &str) -> bool {
    let field = |name: &str| params.get(name).map_or("", String::as_str);
    let expected = control_sum(
        field("status"),
        field("orderid"),
        field("merchant_order"),
        merchant_control,
    );
    // Constant time, and false rather than a panic when the lengths differ
    expected
        .as_bytes()
        .ct_eq(field("control").as_bytes())
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    // The 3DS return is only as good as this checksum: it is what separates a payer coming back
    // from the bank from somebody typing an order id into the address bar. The vectors below were
    // computed outside this code, and are the same ones the Go and Express examples use, so none
    // of them can drift alone.

    const MERCHANT_CONTROL: &str = "test-merchant-control";

    /// sha1("approved" + "1234567" + "hf-abc" + "test-merchant-control")
    const CONTROL: &str = "652ace404c4dfe8bba069ecee594ec23a89340e1";

    fn signed_callback() -> Params {
        Params::from([
            ("status".to_owned(), "approved".to_owned()),
            ("orderid".to_owned(), "1234567".to_owned()),
            ("merchant_order".to_owned(), "hf-abc".to_owned()),
            ("control".to_owned(), CONTROL.to_owned()),
        ])
    }

    #[test]
    fn a_signed_callback_validates() {
        assert!(valid_callback(&signed_callback(), MERCHANT_CONTROL));
    }

    #[test]
    fn every_signed_field_is_covered() {
        for field in ["status", "orderid", "merchant_order"] {
            let mut edited = signed_callback();
            edited.insert(field.to_owned(), "edited".to_owned());
            assert!(
                !valid_callback(&edited, MERCHANT_CONTROL),
                "{field} is not covered by the checksum"
            );
        }
    }

    #[test]
    fn a_wrong_control_is_rejected() {
        // A wrong control of the right length, which is what a guess looks like
        let mut wrong = signed_callback();
        wrong.insert(
            "control".to_owned(),
            format!("{}0", &CONTROL[..CONTROL.len() - 1]),
        );
        assert!(!valid_callback(&wrong, MERCHANT_CONTROL));

        // A control of the wrong length must be rejected rather than panic
        for control in ["", "short", &format!("{CONTROL}extra")] {
            let mut odd = signed_callback();
            odd.insert("control".to_owned(), control.to_owned());
            assert!(
                !valid_callback(&odd, MERCHANT_CONTROL),
                "control {control:?}"
            );
        }
    }

    #[test]
    fn an_empty_callback_still_has_a_checksum() {
        // sha1("" + "" + "" + "test-merchant-control") — an empty callback is not the empty
        // string, so a bare /result must not pass on a missing control.
        assert!(!valid_callback(&Params::new(), MERCHANT_CONTROL));

        let signed = Params::from([(
            "control".to_owned(),
            "1a66987ac24e927ff2979f83a41cb818936a9e62".to_owned(),
        )]);
        assert!(valid_callback(&signed, MERCHANT_CONTROL));
    }
}
