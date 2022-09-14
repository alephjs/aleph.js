use yew::prelude::*;
use yew_router::prelude::*;

use crate::routes::Route;

#[function_component]
pub fn Index() -> Html {
  let icon = html! {
    <svg
      class="w-4 h-4"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M14 5C13.4477 5 13 4.55228 13 4C13 3.44772 13.4477 3 14 3H20C20.2652 3 20.5196 3.10536 20.7071 3.29289C20.8946 3.48043 21 3.73478 21 4L21 10C21 10.5523 20.5523 11 20 11C19.4477 11 19 10.5523 19 10L19 6.41422L9.70711 15.7071C9.31658 16.0976 8.68342 16.0976 8.29289 15.7071C7.90237 15.3166 7.90237 14.6834 8.29289 14.2929L17.5858 5H14ZM3 7C3 5.89543 3.89543 5 5 5H10C10.5523 5 11 5.44772 11 6C11 6.55228 10.5523 7 10 7H5V19H17V14C17 13.4477 17.4477 13 18 13C18.5523 13 19 13.4477 19 14V19C19 20.1046 18.1046 21 17 21H5C3.89543 21 3 20.1046 3 19V7Z"
        fill="#aaa"
      />
    </svg>
  };

  html! {
    <div
      class="w-screen flex flex-col items-center justify-center"
      style="height: calc(100vh - 2 * 80px)"
    >
      <p class="flex">
        <img src="/assets/logo.svg" width="70" height="70" title="Aleph.js" />
        <img src="/assets/yew.png" width="70" height="70" title="Yew" />
      </p>
      <h1 class="text-3xl font-bold mt-2">{"The Fullstack Framework in Deno."}</h1>
      <p class="text-center text-md text-gray-800">
        <strong>{"Aleph.js"}</strong>
        {" gives you the best developer experience for building web applications"}
        <br />
        {"with modern toolings."}
        <label class="border-b-4 border-[#42b883] font-semibold">{"Yew SSR experimental version"}</label>{"."}
      </p>
      <div class="flex gap-4 mt-2">
        <a
          class="flex items-center gap-1.5 text-gray-600 hover:text-gray-900"
          href="https://alephjs.org/docs/get-started"
          target="_blank"
         >
          {"Get Started"}
          {icon.clone()}
        </a>
        <a
          class="flex items-center gap-1.5 text-gray-600 hover:text-gray-900"
          href="https://alephjs.org/docs"
          target="_blank"
        >
          {"Docs"}
          {icon.clone()}
        </a>
        <a
          class="flex items-center gap-1.5 text-gray-600 hover:text-gray-900"
          href="https://github.com/alephjs/aleph.js"
          target="_blank"
        >
          {"Github"}
          {icon}
        </a>
      </div>
      <nav class="mt-8">
        <Link<Route>
          to={Route::Todos}
          classes="inline-flex items-center justify-center w-60 h-12 border-1 border-gray-300 rounded-full hover:border-gray-400 transition-colors duration-300"
        >
          {"Todos App Demo"}
        </Link<Route>>
      </nav>
    </div>
  }
}
