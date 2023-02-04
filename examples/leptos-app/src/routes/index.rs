use leptos::*;

/// A simple counter component.
/// 
/// You can use doc comments like this to document your component.
#[component]
pub fn Counter(
    cx: Scope,
) -> impl IntoView {
    let (value, set_value) = create_signal(cx, 0);
    let step = 1;

    view! { cx,
        <div>
            <button on:click=move |_| set_value(0)>"Clear"</button>
            <button on:click=move |_| set_value.update(|value| *value -= step)>"-1"</button>
            <span>"Value: " {value} "!"</span>
            <button on:click=move |_| set_value.update(|value| *value += step)>"+1"</button>
        </div>
    }
}
