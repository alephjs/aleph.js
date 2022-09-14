use yew::prelude::*;
use yew_router::prelude::*;

use crate::routes::Route;

#[function_component]
pub fn NotFound() -> Html {
  html! {
    <div
      class="w-screen flex flex-col items-center justify-center"
      style="height: calc(100vh - 2 * 80px)"
    >
      <h2 class="text-2xl font-bold mt">
        {"Ooooooops, nothing here!"}
      </h2>
      <p class="mt-2">
        <Link<Route> to={Route::Home} classes="text-gray-500 hover:underline">
          {"Go back to the homepage"}
        </Link<Route>>
      </p>
    </div>
  }
}
