use wasm_bindgen::prelude::*;

mod app;
mod components;
mod routes;
mod shared;

#[wasm_bindgen]
pub fn main() {
  yew::Renderer::<app::App>::new().hydrate();
}

// todo: support router
#[wasm_bindgen]
pub async fn ssr(url: String) -> Result<JsValue, JsValue> {
  let html = yew::ServerRenderer::<app::App>::with_props(app::AppProps { ssr_url: Some(url) })
    .render()
    .await;
  Ok(JsValue::from_str(&html))
}
