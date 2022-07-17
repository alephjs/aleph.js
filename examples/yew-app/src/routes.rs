pub mod _404;
pub mod index;
pub mod todos;

use index::Index;
use todos::Todos;
use _404::NotFound;

use crate::shared::Route;
use yew::prelude::*;

pub fn switch(routes: Route) -> Html {
  match routes {
    Route::Home => html! { <Index /> },
    Route::Todos => html! { <Todos /> },
    Route::NotFound => html! { <NotFound/> },
  }
}
