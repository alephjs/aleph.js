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
  Ok(serde_wasm_bindgen::to_value(&html).unwrap())
}
