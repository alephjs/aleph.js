import { bytes } from "../deps.ts";
import { FormDataBody, FormFile } from "../types.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const encode = {
    contentType: encoder.encode("Content-Type"),
    filename: encoder.encode("filename"),
    name: encoder.encode("name"),
    dashdash: encoder.encode("--"),
    boundaryEqual: encoder.encode("boundary="),
    returnNewline2: encoder.encode("\r\n\r\n"),
    carriageReturn: encoder.encode("\r"),
};

export async function multiParser(
    body: Deno.Reader,
    contentType: string
): Promise<FormDataBody> {
    let buf = await Deno.readAll(body);
    let boundaryByte = getBoundary(contentType);

    if (!boundaryByte) {
        throw new Error("No boundary data information");
    }

    // Generate an array of Uint8Array
    const pieces = getFieldPieces(buf, boundaryByte!);

    // Set all the pieces into one single object
    const form = getForm(pieces);

    return form;
}

function createFormData(): FormDataBody {
    return {
        fields: {},
        files: [],
        getFile(key: string) {
            return this.files.find((i) => i.name === key);
        },
        get(key: string) {
            return this.fields[key];
        },
    };
}

function getForm(pieces: Uint8Array[]) {
    let form: FormDataBody = createFormData();

    for (let piece of pieces) {
        const { headerByte, contentByte } = splitPiece(piece);
        const headers = getHeaders(headerByte);

        // it's a string field
        if (typeof headers === "string") {
            // empty content, discard it
            if (contentByte.byteLength === 1 && contentByte[0] === 13) {
                continue;
            }

            // headers = "field1"
            else {
                form.fields[headers] = decoder.decode(contentByte);
            }
        }

        // it's a file field
        else {
            let file: FormFile = {
                name: headers.name,
                filename: headers.filename,
                contentType: headers.contentType,
                size: contentByte.byteLength,
                content: contentByte,
            };

            form.files.push(file);
        }
    }
    return form;
}

function getHeaders(headerByte: Uint8Array) {
    let contentTypeIndex = bytes.indexOf(headerByte, encode.contentType);

    // no contentType, it may be a string field, return name only
    if (contentTypeIndex < 0) {
        return getNameOnly(headerByte);
    }

    // file field, return with name, filename and contentType
    else {
        return getHeaderNContentType(headerByte, contentTypeIndex);
    }
}

function getHeaderNContentType(
    headerByte: Uint8Array,
    contentTypeIndex: number,
) {
    let headers: Record<string, string> = {};

    let contentDispositionByte = headerByte.slice(0, contentTypeIndex - 2);
    headers = getHeaderOnly(contentDispositionByte);

    // jump over <Content-Type: >
    let contentTypeByte = headerByte.slice(
        contentTypeIndex + encode.contentType.byteLength + 2,
    );

    headers.contentType = decoder.decode(contentTypeByte);
    return headers;
}

function getHeaderOnly(headerLineByte: Uint8Array) {
    let headers: Record<string, string> = {};

    let filenameIndex = bytes.indexOf(headerLineByte, encode.filename);
    if (filenameIndex < 0) {
        headers.name = getNameOnly(headerLineByte);
    } else {
        headers = getNameNFilename(headerLineByte, filenameIndex);
    }
    return headers;
}

function getNameNFilename(headerLineByte: Uint8Array, filenameIndex: number) {
    // fetch filename first
    let nameByte = headerLineByte.slice(0, filenameIndex - 2);
    let filenameByte = headerLineByte.slice(
        filenameIndex + encode.filename.byteLength + 2,
        headerLineByte.byteLength - 1,
    );

    let name = getNameOnly(nameByte);
    let filename = decoder.decode(filenameByte);
    return { name, filename };
}

function getNameOnly(headerLineByte: Uint8Array) {
    let nameIndex = bytes.indexOf(headerLineByte, encode.name);

    // jump <name="> and get string inside double quote => "string"
    let nameByte = headerLineByte.slice(
        nameIndex + encode.name.byteLength + 2,
        headerLineByte.byteLength - 1,
    );

    return decoder.decode(nameByte);
}

function splitPiece(piece: Uint8Array) {
    const contentIndex = bytes.indexOf(piece, encode.returnNewline2);
    const headerByte = piece.slice(0, contentIndex);
    const contentByte = piece.slice(contentIndex + 4);

    return { headerByte, contentByte };
}

function getFieldPieces(
    buf: Uint8Array,
    boundaryByte: Uint8Array,
): Uint8Array[] {
    const startBoundaryByte = bytes.concat(encode.dashdash, boundaryByte);
    const endBoundaryByte = bytes.concat(startBoundaryByte, encode.dashdash);

    const pieces = [];

    while (!bytes.startsWith(buf, endBoundaryByte)) {
        // jump over boundary + '\r\n'
        buf = buf.slice(startBoundaryByte.byteLength + 2);
        let boundaryIndex = bytes.indexOf(buf, startBoundaryByte);

        // get field content piece
        pieces.push(buf.slice(0, boundaryIndex - 1));
        buf = buf.slice(boundaryIndex);
    }

    return pieces;
}

function getBoundary(contentType: string): Uint8Array | undefined {
    let contentTypeByte = encoder.encode(contentType);
    let boundaryIndex = bytes.indexOf(contentTypeByte, encode.boundaryEqual);

    if (boundaryIndex >= 0) {
        // jump over 'boundary=' to get the real boundary
        let boundary = contentTypeByte.slice(
            boundaryIndex + encode.boundaryEqual.byteLength,
        );
        return boundary;
    } else {
        return undefined;
    }
}
