use wasm_bindgen::prelude::*;

mod app;

#[wasm_bindgen]
pub fn main() {
    yew::Renderer::<app::App>::new().hydrate();
}

#[wasm_bindgen]
pub async fn ssr() -> Result<JsValue, JsValue> {
    let html = yew::ServerRenderer::<app::App>::new().render().await;
    Ok(JsValue::from_str(&html))
}
