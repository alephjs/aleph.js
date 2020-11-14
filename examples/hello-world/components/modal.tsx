/// <reference lib="dom" />
import { Component, PropsWithChildren } from 'https://esm.sh/react'
import ReactDOM from 'https://esm.sh/react-dom'

const modalRoot = document.createElement('div')
modalRoot.id="modal-root"
document.body.appendChild(modalRoot)

export default class Modal extends Component {
    el: HTMLElement

    constructor(props: PropsWithChildren<{}>) {
        super(props)
        this.el = document.createElement('div')
    }

    componentDidMount() {
        modalRoot.appendChild(this.el)
    }

    componentWillUnmount() {
        modalRoot.removeChild(this.el)
    }

    render() {
        return ReactDOM.createPortal(
            this.props.children,
            this.el
        )
    }
}
