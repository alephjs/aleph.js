import React from "react";
import { hydrate } from "react-dom";
import { Router } from "aleph/react";
import "./style/index.css";

hydrate(
  <Router />,
  document.querySelector("#root"),
);
