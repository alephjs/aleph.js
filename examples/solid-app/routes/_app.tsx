import type { ParentProps } from "solid-js";
import Header from "../components/Header.tsx";

export default function App(props: ParentProps) {
  return (
    <>
      <Header />
      {props.children}
    </>
  );
}
