var _a, _b, _c, _d, _e, _f, _g;
// ? registers identifiers used in JSX at definition site
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
    return (<div>
            <A />
            <B />
            <StyledFactory1 />
            <StyledFactory2 />
            <StyledFactory3 />
            <Alias1 />
            <Alias2 />
            <Header />
            <Dict.X />
        </div>);
}
_e = Foo;
$RefreshReg$(_e, "Foo");
const B = hoc(A);
_f = B;
$RefreshReg$(_f, "B");
// This is currently registered as a false positive:
const NotAComponent = wow(A);
_g = NotAComponent;
$RefreshReg$(_g, "NotAComponent");
