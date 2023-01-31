use cfg_if::cfg_if;
cfg_if! {
    if #[cfg(feature = "hydrate")] {
        use wasm_bindgen::prelude::wasm_bindgen;
        use leptos::*;
        use leptos_router::{BrowserIntegration, RouterIntegrationContext};
        pub mod routes;
        use routes::{App, AppProps};

        #[wasm_bindgen]
        pub fn hydrate() {
            console_error_panic_hook::set_once();
            _ = console_log::init_with_level(log::Level::Debug);
            console_error_panic_hook::set_once();

            web_sys::console::log_1(&"hydrate".into());

            let history = BrowserIntegration{};
            let router_integration = RouterIntegrationContext::new(history);

            mount_to_body(|cx| {
                provide_context::<RouterIntegrationContext>(cx, router_integration);
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
            let html = run_scope(create_runtime(), move |cx| {
                provide_context::<RouterIntegrationContext>(cx, router_integration);
                view! { cx, <App/> }.into_view(cx).render_to_string(cx)
            })
            .to_string();
            html
        }
    }
}
