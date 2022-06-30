use yew::prelude::*; 
use yew_router::prelude::*;

use crate::shared::Route;

#[function_component]
pub fn Index() -> Html {
  html! {
    <div class="index screen">
      <p class="logo">
        <img src="/assets/logo.svg" width="70" height="70" title="Aleph.js" />
        <img src="/assets/yew.png" width="70" height="70" title="Yew" />
      </p>
      <h1>{"The Fullstack Framework in Deno."}</h1>
      <p>
        <strong>{"Aleph.js"}</strong>
        {" gives you the best developer experience for building web applications"}
        <br />
        {"with modern toolings."} <label>{"Yew SSR experimental version"}</label>{"."}
      </p>
      <div class="external-links">
        <a href="https://alephjs.org/docs/get-started" target="_blank">
          {"Get Started"}
        </a>
        <a href="https://alephjs.org/docs" target="_blank">
          {"Docs"}
        </a>
        <a href="https://github.com/alephjs/aleph.js" target="_blank">
          {"Github"}
        </a>
      </div>
      <nav>
        <Link<Route> to={Route::Todos}>
          {"Todos App Demo"}
        </Link<Route>>
      </nav>
    </div>
  }
}
