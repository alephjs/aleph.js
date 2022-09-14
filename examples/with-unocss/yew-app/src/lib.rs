mod app;
mod components;
mod routes;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn main() {
  yew::Renderer::<app::App>::new().hydrate();
}

#[wasm_bindgen]
pub async fn ssr(url: String) -> Result<JsValue, JsValue> {
  let html = yew::ServerRenderer::<app::App>::with_props(app::AppProps { ssr_url: Some(url) })
    .render()
    .await;
  Ok(JsValue::from_str(&html))
}

extern crate wee_alloc;

// Use `wee_alloc` as the global allocator.
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;
