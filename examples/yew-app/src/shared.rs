use yew_router::prelude::*;

#[derive(Clone, Routable, PartialEq)]
pub enum Route {
  #[at("/")]
  Home,
  #[at("/todos")]
  Todos,
  #[not_found]
  #[at("/404")]
  NotFound,
}
