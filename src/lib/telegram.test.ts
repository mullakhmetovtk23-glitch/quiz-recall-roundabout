import { describe, expect, it } from "vitest";
import { buildPhotoMap, flattenText, parseTelegramExport } from "./telegram";

describe("Telegram result.json parser", () => {
  it("joins plain strings and .text of formatting objects", () => {
    expect(
      flattenText(["Мария ", { type: "bold", text: "Кюри" }, " — ", { type: "link", text: "wiki" }]),
    ).toBe("Мария Кюри — wiki");
  });

  it("keeps only type=message and skips posts without text and photo", () => {
    const res = parseTelegramExport({
      id: 123,
      name: "Бинго",
      messages: [
        { id: 1, type: "service", text: "joined" },
        { id: 2, type: "message", text: "" },
        { id: 3, type: "message", text: [{ type: "italic", text: "Факт" }] },
        { id: 4, type: "message", text: "", photo: "photos/photo_4.jpg" },
      ],
    });
    expect(res.chatId).toBe("123");
    expect(res.posts.map((p) => p.tgMessageId)).toEqual([3, 4]);
    expect(res.posts[1]?.photo).toBe("photos/photo_4.jpg");
  });

  it("maps photos relative to result.json inside a picked folder", () => {
    const mk = (path: string) => {
      const f = new File(["x"], path.split("/").pop()!);
      Object.defineProperty(f, "webkitRelativePath", { value: path });
      return f;
    };
    const { resultFile, photos } = buildPhotoMap([
      mk("Export/result.json"),
      mk("Export/photos/photo_1.jpg"),
    ]);
    expect(resultFile?.name).toBe("result.json");
    expect(photos.has("photos/photo_1.jpg")).toBe(true);
  });
});
