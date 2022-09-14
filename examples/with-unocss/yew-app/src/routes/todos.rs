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
  let ontoggle = {
    let ontoggle = props.ontoggle.clone();
    move |_| ontoggle.emit(id)
  };
  let onremove = {
    let onremove = props.onremove.clone();
    move |_| onremove.emit(id)
  };

  html! {
    <li class="flex items-center justify-between gap-2 px-3 py-1.5">
      <div class={
        if props.todo.completed {
          "flex items-center justify-center w-4.5 h-4.5 border rounded-full border-teal-500/50"
        } else {
          "flex items-center justify-center w-4.5 h-4.5 border rounded-full border-gray-300"
        }
      } onclick={ontoggle}>
        if props.todo.completed {
          <span class="inline-block w-1.5 h-1.5 bg-teal-500 rounded-full" />
        }
      </div>
      <label class={
        if props.todo.completed {
          "flex-1 text-xl text-gray-400 font-300 line-through"
        } else {
          "flex-1 text-xl text-gray-700 font-300"
        }
      }>{&props.todo.title}</label>
      <button onclick={onremove}>
        <svg
          class="w-5 h-5 text-gray-300 hover:text-red-500"
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M17.2533 15.9999L24.6221 8.63106C24.7678 8.46101 24.8439 8.24228 24.8352 8.01857C24.8266 7.79485 24.7338 7.58264 24.5755 7.42434C24.4172 7.26603 24.205 7.17329 23.9813 7.16465C23.7576 7.15601 23.5389 7.2321 23.3688 7.37773L15.9999 14.7466L8.63103 7.36884C8.46365 7.20146 8.23663 7.10742 7.99992 7.10742C7.76321 7.10742 7.53619 7.20146 7.36881 7.36884C7.20143 7.53622 7.1074 7.76324 7.1074 7.99995C7.1074 8.23666 7.20143 8.46368 7.36881 8.63106L14.7466 15.9999L7.36881 23.3688C7.27576 23.4485 7.20019 23.5466 7.14683 23.6569C7.09348 23.7671 7.0635 23.8873 7.05877 24.0097C7.05404 24.1321 7.07467 24.2542 7.11936 24.3682C7.16404 24.4823 7.23183 24.5859 7.31846 24.6725C7.40508 24.7592 7.50868 24.8269 7.62275 24.8716C7.73681 24.9163 7.85889 24.9369 7.9813 24.9322C8.10372 24.9275 8.22384 24.8975 8.33412 24.8441C8.4444 24.7908 8.54246 24.7152 8.62214 24.6222L15.9999 17.2533L23.3688 24.6222C23.5389 24.7678 23.7576 24.8439 23.9813 24.8352C24.205 24.8266 24.4172 24.7339 24.5755 24.5756C24.7338 24.4173 24.8266 24.205 24.8352 23.9813C24.8439 23.7576 24.7678 23.5389 24.6221 23.3688L17.2533 15.9999Z"
            fill="currentColor"
          />
        </svg>
      </button>
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
    <div class="w-9/10 max-w-150 mx-auto mt-15">
      <h1 class="flex items-center justify-between text-5xl font-200">
        <span>{"Todos"}</span>
        if *all_todos > 0 {
          <em class="text-3xl text-gray-300">{completed_todos}{"/"}{all_todos}</em>
        }
      </h1>
      <ul class="mt-6">
      { for todos.iter().map(|todo| html! {
        <Entry
          todo={todo.clone()}
          ontoggle={ontoggle.clone()}
          onremove={onremove.clone()}
        />
      }) }
      </ul>
      <form class="mt-6" onsubmit={onadd}>
        <input
          class="block w-full py-2 px-4 text-2xl font-300 placeholder:italic placeholder:text-gray-400 bg-gray-50 rounded-lg outline-none"
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
