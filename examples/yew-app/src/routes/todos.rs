use web_sys::HtmlInputElement;
use yew::prelude::*;

#[derive(Clone, Debug, PartialEq)]
struct Todo {
  id: usize,
  completed: bool,
  title: String,
}

#[derive(PartialEq, Properties, Clone)]
struct EntryProps {
  pub todo: Todo,
  pub ontoggle: Callback<usize>,
  pub onremove: Callback<usize>,
}

#[function_component]
fn Entry(props: &EntryProps) -> Html {
  let id = props.todo.id;
  let lablel_class = if props.todo.completed {
    "completed"
  } else {
    ""
  };
  let ontoggle = {
    let ontoggle = props.ontoggle.clone();
    move |_| ontoggle.emit(id)
  };
  let onremove = {
    let onremove = props.onremove.clone();
    move |_| onremove.emit(id)
  };

  html! {
    <li>
      <input type="checkbox" checked={props.todo.completed} onclick={ontoggle} />
      <label class={lablel_class}>{&props.todo.title}</label>
      <button onclick={onremove}></button>
    </li>
  }
}

#[function_component]
pub fn Todos() -> Html {
  let todos = use_state(|| Vec::<Todo>::new());
  let all_todos = use_memo(|todos| todos.len(), todos.clone());
  let completed_todos = use_memo(|todos| todos.iter().filter(|t| t.completed).count(), todos.clone());
  let input_node_ref = use_node_ref();

  let onadd = {
    let todos = todos.clone();
    let input_node_ref = input_node_ref.clone();
    Callback::from(move |e: FocusEvent| {
      e.prevent_default();
      let input = input_node_ref.cast::<HtmlInputElement>().unwrap();
      let mut v = todos.to_vec();
      v.push(Todo {
        id: todos.to_vec().len() + 1,
        completed: false,
        title: input.value().trim().to_string(),
      });
      input.set_value("");
      todos.set(v)
    })
  };
  let ontoggle = {
    let todos = todos.clone();
    Callback::from(move |id: usize| {
      todos.set(
        todos
          .to_vec()
          .into_iter()
          .map(|t| {
            if t.id == id {
              Todo {
                id: t.id,
                completed: !t.completed,
                title: t.title,
              }
            } else {
              t
            }
          })
          .collect(),
      )
    })
  };
  let onremove = {
    let todos = todos.clone();
    Callback::from(move |id: usize| todos.set(todos.to_vec().into_iter().filter(|t| t.id != id).collect()))
  };

  html! {
    <div class="todos-app">
      <h1>
        <span>{"Todos"}</span>
        if *all_todos > 0 {
          <em>{completed_todos}{"/"}{all_todos}</em>
        }
      </h1>
      <ul>
      { for todos.iter().map(|todo| html! {
        <Entry
          todo={todo.clone()}
          ontoggle={ontoggle.clone()}
          onremove={onremove.clone()}
        />
      }) }
      </ul>
      <form onsubmit={onadd}>
        <input
          type="text"
          ref={input_node_ref}
          name="message"
          placeholder="What needs to be done?"
          autocomplete="off"
          autofocus={true}
        />
      </form>
    </div>
  }
}
