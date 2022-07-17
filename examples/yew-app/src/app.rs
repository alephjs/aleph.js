use std::collections::HashMap;
use url::Url;
use yew::prelude::*;
use yew_router::history::{AnyHistory, History, MemoryHistory};
use yew_router::prelude::*;

use crate::components::header::Header;
use crate::routes::switch;
use crate::shared::Route;

#[derive(Properties, PartialEq, Default)]
pub struct AppProps {
  pub ssr_url: Option<String>,
}

#[function_component]
pub fn App(props: &AppProps) -> Html {
  if let Some(url) = &props.ssr_url {
    let history = AnyHistory::from(MemoryHistory::new());
    let url = Url::parse(url).unwrap();
    let mut queries: HashMap<String, String> = HashMap::new();
    for (key, value) in url.query_pairs() {
      queries.insert(key.into(), value.into());
    }
    history.push_with_query(url.path(), queries).unwrap();
    html! {
      <Router history={history}>
        <Header/>
        <Switch<Route> render={switch} />
     </Router>
    }
  } else {
    html! {
      <BrowserRouter>
        <Header/>
        <Switch<Route> render={switch} />
      </BrowserRouter>
    }
  }
}
