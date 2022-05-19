use wasm_bindgen::prelude::*;
use yew::prelude::*;

#[function_component]
fn App() -> Html {
    let counter = use_state(|| 0);
    let onclick = {
        let counter = counter.clone();
        move |_| {
            let value = *counter + 1;
            counter.set(value);
        }
    };

    html! {
        <div class={"index screen"}>
        <p class={"logo"}>
      <img src={"/assets/logo.svg"} width={"70"} height={"70"} title={"Aleph.js"} />
      <img src={"/assets/yew.png"} width={"70"} height={"70"} title={"Yew"} />
    </p>
    <h1>
      {"The Fullstack Framework in Deno."}
    </h1>
    <p>
      <strong>{"Aleph.js"}</strong>
     {" gives you the best developer experience for building web applications"}
      <br />
     {" with modern toolings."} <label>{"Yew SSR experimental version"}</label>{"."}
    </p>
    <div class={"external-links"}>
      <a href={"https://alephjs.org/docs/get-started"} target={"_blank"}>
       {"Get Started"}
      </a>
      <a href={"https://alephjs.org/docs"} target={"_blank"}>
        {"Docs"}
      </a>
      <a href={"https://github.com/alephjs/aleph.js"} target={"_blank"}>
        {"Github"}
      </a>
    </div>
    <nav> <button onclick={onclick}>
    {"Counter:"}
  <strong>{ *counter }</strong>
  <small>{"Click to add 1"}</small>
</button></nav>

        </div>
    }
}

#[wasm_bindgen]
pub fn main() {
    yew::Renderer::<App>::new().hydrate();
}

#[wasm_bindgen]
pub async fn ssr() -> Result<JsValue, JsValue> {
    let html = yew::ServerRenderer::<App>::new().render().await;
    Ok(JsValue::from_str(&html))
}
