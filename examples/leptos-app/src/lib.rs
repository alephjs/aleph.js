use cfg_if::cfg_if;
cfg_if! {
    if #[cfg(feature = "hydrate")] {
        use wasm_bindgen::prelude::wasm_bindgen;
        use leptos::*;
        pub mod routes;
        use routes::{App, AppProps};

        #[wasm_bindgen]
        pub fn hydrate() {
            console_error_panic_hook::set_once();
            _ = console_log::init_with_level(log::Level::Debug);

            mount_to_body(|cx| {
                view! { cx,  <App/> }
            })
        }
    }

    else if #[cfg(feature = "ssr")] {
        use wasm_bindgen::prelude::wasm_bindgen;
        use leptos::*;
        use leptos_router::{ServerIntegration, RouterIntegrationContext};
        pub mod routes;
        use routes::{App, AppProps};

        #[wasm_bindgen]
        pub fn ssr(url: String) -> String {
            let history = ServerIntegration { path: url };
            let router_integration = RouterIntegrationContext::new(history);
            render_to_string(move |cx| {
                provide_context::<RouterIntegrationContext>(cx, router_integration);
                view! { cx, <App/> }
            })
        }
    }
}
