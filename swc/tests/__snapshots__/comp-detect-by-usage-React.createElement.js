var _a, _b, _c, _d, _e, _f, _g;
// ? registers identifiers used in React.createElement at definition site
import A from './A';
import Store from './Store';
Store.subscribe();
const Header = styled.div `
    color: red;
`;
_a = Header;
$RefreshReg$(_a, "Header");
const StyledFactory1 = styled('div') `
    color: hotpink;
`;
_b = StyledFactory1;
$RefreshReg$(_b, "StyledFactory1");
const StyledFactory2 = styled('div')({ color: 'hotpink' });
_c = StyledFactory2;
$RefreshReg$(_c, "StyledFactory2");
const StyledFactory3 = styled(A)({ color: 'hotpink' });
_d = StyledFactory3;
$RefreshReg$(_d, "StyledFactory3");
const FunnyFactory = funny.factory ``;
let Alias1 = A;
let Alias2 = A.Foo;
const Dict = {};
function Foo() {
    return [
        React.createElement(A),
        React.createElement(B),
        React.createElement(StyledFactory1),
        React.createElement(StyledFactory2),
        React.createElement(StyledFactory3),
        React.createElement(Alias1),
        React.createElement(Alias2),
        jsx(Header),
        React.createElement(Dict.X),
    ];
}
_e = Foo;
$RefreshReg$(_e, "Foo");
React.createContext(Store);
const B = hoc(A);
_f = B;
$RefreshReg$(_f, "B");
// This is currently registered as a false positive:
const NotAComponent = wow(A);
_g = NotAComponent;
$RefreshReg$(_g, "NotAComponent");
