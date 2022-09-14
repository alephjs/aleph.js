pub mod _404;
pub mod index;
pub mod todos;

use yew::prelude::*;
use yew_router::prelude::*;
use index::Index;
use todos::Todos;
use _404::NotFound;

#[derive(Clone, Routable, PartialEq)]
pub enum Route {
  #[at("/")]
  Home,
  #[at("/todos")]
  Todos,
  #[at("/404")]
  #[not_found]
  NotFound,
}

pub fn switch(routes: Route) -> Html {
  match routes {
    Route::Home => html! { <Index /> },
    Route::Todos => html! { <Todos /> },
    Route::NotFound => html! { <NotFound/> },
  }
}
