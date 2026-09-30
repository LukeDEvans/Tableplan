import { describe, it, expect } from "vitest";
import { parseVcf, vcardUnescape, buildContactsVcf, normalizeContacts } from "../contacts.js";

let n = 0;
const createId = (p) => `${p}-${++n}`;
const card = (...lines) => ["BEGIN:VCARD", "VERSION:3.0", ...lines, "END:VCARD"].join("\r\n");

describe("parseVcf — CON-1 Apple group prefix + TYPE labels", () => {
  it("recognises item1.EMAIL / item2.TEL and skips generic TYPE values", () => {
    const [c] = parseVcf(card(
      "FN:Ann Lee",
      "item1.EMAIL;type=INTERNET;type=HOME;type=pref:ann@example.com",
      "item2.TEL;TYPE=VOICE,CELL,pref:+1 555 0100",
      "EMAIL;TYPE=INTERNET:plain@example.com",
    ));
    expect(c.emails).toEqual([
      { label: "HOME", value: "ann@example.com" },
      { label: "Email", value: "plain@example.com" },
    ]);
    expect(c.phones).toEqual([{ label: "CELL", value: "+1 555 0100" }]);
  });
});

describe("parseVcf — CON-2 escaping", () => {
  it("unescapes in a single pass", () => {
    expect(vcardUnescape("a\\\\nb")).toBe("a\\nb"); // escaped backslash + literal n
    expect(vcardUnescape("a\\nb\\Nc")).toBe("a\nb\nc");
    expect(vcardUnescape("x\\,y\\;z")).toBe("x,y;z");
  });
  it("splits N/ADR on unescaped ; and CATEGORIES on unescaped ,", () => {
    const [c] = parseVcf(card(
      "N:Smith\\;Jones;Bo;;;",
      "ADR;TYPE=Home:;;1 Main St\\; Apt 2;Town;;;",
      "CATEGORIES:Family,Work\\, Old,Friends",
    ));
    expect(c.lastName).toBe("Smith;Jones");
    expect(c.firstName).toBe("Bo");
    expect(c.addresses[0].value).toBe("1 Main St; Apt 2, Town");
    expect(c.groups).toEqual(["Family", "Work, Old", "Friends"]);
  });
});

describe("parseVcf — CON-3 PHOTO", () => {
  it("imports base64 photos (folded, 3.0 and 2.1 forms)", () => {
    const [a] = parseVcf(card("FN:A", "PHOTO;ENCODING=b;TYPE=JPEG:QUJD", " REVG"));
    expect(a.photo).toBe("data:image/jpeg;base64,QUJDREVG");
    const [b] = parseVcf(card("FN:B", "PHOTO;ENCODING=BASE64;TYPE=PNG:QUJD"));
    expect(b.photo).toBe("data:image/png;base64,QUJD");
  });
  it("rejects non-base64 payloads and URL photos", () => {
    expect(parseVcf(card("FN:A", "PHOTO;ENCODING=b:<script>"))[0].photo).toBe("");
    expect(parseVcf(card("FN:A", "PHOTO;VALUE=uri:http://x/y.jpg"))[0].photo).toBe("");
  });
});

describe("parseVcf — CON-4 quoted-printable (vCard 2.1)", () => {
  it("decodes UTF-8 =XX sequences and joins soft line breaks", () => {
    const text = [
      "BEGIN:VCARD", "VERSION:2.1",
      "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:M=C3=BCller;J=C3=BCrgen;;;",
      "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:J=C3=BCrgen M=C3=BC=",
      "ller",
      "NOTE;QUOTED-PRINTABLE:line1=0D=0Aline2",
      "TEL;CELL:123",
      "END:VCARD",
    ].join("\r\n");
    const [c] = parseVcf(text);
    expect(c.lastName).toBe("Müller");
    expect(c.firstName).toBe("Jürgen");
    expect(c.name).toBe("Jürgen Müller");
    expect(c.notes).toBe("line1\r\nline2");
    expect(c.phones).toEqual([{ label: "CELL", value: "123" }]);
  });
  it("does not join a base64 line ending in = with the next line", () => {
    const [c] = parseVcf(card("FN:A", "PHOTO;ENCODING=b:QUI=", "EMAIL:a@b.c"));
    expect(c.photo).toBe("data:image/jpeg;base64,QUI=");
    expect(c.emails[0].value).toBe("a@b.c");
  });
});

describe("parseVcf — CON-5 year-less birthdays", () => {
  it("drops Apple's omit-year placeholder and pre-1900 years", () => {
    expect(parseVcf(card("FN:A", "BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-15"))[0].birthday).toBe("03-15");
    expect(parseVcf(card("FN:A", "BDAY:1604-03-15"))[0].birthday).toBe("03-15");
    expect(parseVcf(card("FN:A", "BDAY:--0315"))[0].birthday).toBe("03-15");
    expect(parseVcf(card("FN:A", "BDAY:1990-03-15"))[0].birthday).toBe("1990-03-15");
    expect(parseVcf(card("FN:A", "BDAY;X-APPLE-OMIT-YEAR=1604:1990-03-15"))[0].birthday).toBe("1990-03-15");
  });
});

describe("normalizeContacts — CON-9 strict photo", () => {
  it("keeps only plain base64 image data URLs", () => {
    const photos = [
      "data:image/jpeg;base64,QUJD",
      "data:image/svg+xml;base64,QUJD",
      "data:image/png;base64,QU JD",
      "data:image/jpeg;base64,QUJD\" onerror=\"x",
      "data:imagefoo",
    ];
    const out = normalizeContacts(photos.map((photo) => ({ name: "A", photo })), createId);
    expect(out.map((c) => c.photo)).toEqual(["data:image/jpeg;base64,QUJD", "", "", "", ""]);
  });
});

describe("buildContactsVcf → parseVcf round trip", () => {
  it("preserves every exported field", () => {
    const src = normalizeContacts([{
      firstName: "Zoë", lastName: "O'Brien; Jr",
      photo: "data:image/png;base64,QUJDREVG",
      phones: [{ label: "Work, main", value: "+1 555 0101" }],
      emails: [{ label: "Home", value: "zoe@example.com" }],
      birthday: "04-02",
      dates: [{ label: "Anniversary", value: "2010-06-01" }, { label: "Met", value: "09-09" }],
      addresses: [{ label: "Home", value: "1 Main St; Apt 2" }],
      groups: ["Family", "Work, Old"],
      notes: "Line one\nback\\slash, semi; colon:",
    }], createId);
    const [back] = parseVcf(buildContactsVcf(src));
    const s = src[0];
    expect(back.firstName).toBe(s.firstName);
    expect(back.lastName).toBe(s.lastName);
    expect(back.name).toBe(s.name);
    expect(back.photo).toBe(s.photo);
    expect(back.phones).toEqual(s.phones.map(({ label, value }) => ({ label, value })));
    expect(back.emails).toEqual(s.emails.map(({ label, value }) => ({ label, value })));
    expect(back.birthday).toBe("04-02");
    expect(back.dates).toEqual(s.dates.map(({ label, value }) => ({ label, value })));
    expect(back.addresses.map((a) => a.value)).toEqual(["1 Main St; Apt 2"]);
    expect(back.groups).toEqual(s.groups);
    expect(back.notes).toBe(s.notes);
  });
});
