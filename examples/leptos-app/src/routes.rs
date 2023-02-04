use leptos::*;
use leptos_meta::*;
use leptos_router::*;

pub mod index;
use index::{Counter, CounterProps};

#[component]
pub fn App(cx: Scope) -> impl IntoView {
    provide_meta_context(cx);
    view! {
        cx,
        <Router>
            <main>
                <Routes>
                    <Route path="" view=|cx| view! {
                        cx,
                        <Counter/>
                    }/>
                </Routes>
            </main>
        </Router>
    }
}
