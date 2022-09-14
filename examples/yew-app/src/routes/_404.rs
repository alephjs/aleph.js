use yew::prelude::*;
use yew_router::prelude::*;

use crate::routes::Route;

#[function_component]
pub fn NotFound() -> Html {
  html! {
    <div class="screen e404">
      <h2>
        {"Ooooooops, nothing here!"}
      </h2>
      <p>
        <Link<Route> to={Route::Home}>{"Go back to the homepage"}</Link<Route>>
      </p>
    </div>
  }
}
