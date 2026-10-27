# PO Team Live for VS Code

Lập team AI theo từng project ngay trong editor bằng Office 3D, bảng việc, timeline, sơ đồ luồng và thống kê. Chọn bất kỳ model nào từ proxy làm điều phối; model đó phân tích yêu cầu và project, đề xuất các vị trí, lập plan và hướng giao việc. Kéo thanh replay để xem lại từng sự kiện hoặc bấm **Trực tiếp** để quay về hiện tại.

Extension kết nối trực tiếp proxy OpenAI-compatible bằng base URL và API key. Nó tự quét `/models` (thử thêm `/v1/models` khi cần). API key lưu trong SecretStorage của VS Code và không gửi sang webview.

Không mở cổng HTTP và không cần router local chạy. Phần xem nhật ký cũ và demo dùng được offline, không cần API key. Thư viện 3D được đóng gói sẵn.

## Cài đặt và mở

1. Cài file `po-team-live-0.7.0.vsix` bằng **Extensions: Install from VSIX…**, hoặc `code --install-extension <đường-dẫn-vsix>`. Sau khi nâng cấp, chạy **Developer: Reload Window** để nạp phiên bản mới.
2. Chạy **PO Team: Mở giao diện** trong Command Palette (`Ctrl+Shift+P`), hoặc chọn biểu tượng PO Team ở Activity Bar.
3. Chọn session trong danh sách **Session trong project**, hoặc bấm **+ Session mới**. Bấm **Chạy demo** nếu muốn thử trước. Demo chỉ sinh sự kiện mô phỏng, không gọi model.
4. Bấm tên file để mở trong editor: file đã có mở từ workspace; code đề xuất chưa áp dụng mở thành bản xem chỉ đọc, giữ nguyên nội dung và tô màu cú pháp. Dùng **Xem thay đổi / Áp dụng** để ghi code vào project. Nếu đường dẫn mới chỉ nằm trong plan, extension giải thích rằng chưa có code. Đường dẫn demo mở tài liệu giải thích mô phỏng, không tạo file giả trong project.

## Kết nối trực tiếp và giao việc

Kế hoạch được kiểm tra ID vị trí/task, model, đường dẫn và phụ thuộc trước khi giao việc. Khi cấu trúc không hợp lệ, điều phối nhận bản kế hoạch cùng lỗi cụ thể để sửa tối đa hai lần, không đọc lại toàn project hoặc tự chạy worker trước khi plan hợp lệ. Các ID dành riêng cho hệ thống được nêu rõ trong prompt nội bộ.

Lỗi HTTP tạm thời (429, 500, 502–504, 520–524) tự thử lại tối đa 2 lần trên cùng endpoint, model và payload. Chờ 1 rồi 2 giây, hoặc theo Retry-After tối đa 10 giây; request văn bản/ảnh giữ hạn 300 giây. Dừng hủy cả thời gian chờ. Lỗi 400/401 không tự thử lại. Trang lỗi HTML được thay bằng thông báo ngắn; proxy hỏng kéo dài vẫn cần nhà cung cấp xử lý.

Mở **Yêu cầu** ở cột trái để đọc nguyên văn **Yêu cầu đã gửi** của session đang chọn, kể cả sau khi mở lại VS Code hoặc session kết thúc do lỗi. Có thể thu gọn và chọn văn bản để copy. Ô **Giao yêu cầu mới** được thu gọn riêng để không nhầm với prompt cũ; session trống tự mở form nhập việc. Đây là prompt người dùng đã gửi, không phải toàn bộ system prompt hay nội dung tool nội bộ.

Mỗi bước có tối đa 24 vòng đọc project. Khi hết lượt hoặc model yêu cầu cùng nhóm tool 3 vòng liên tiếp, extension yêu cầu tổng hợp JSON từ dữ liệu đã đọc thay vì hủy ngay. File đọc lại dùng cùng bản dữ liệu trong bước đó; bước tiếp theo đọc mới. Kết quả còn phụ thuộc việc model trả đúng JSON; hủy tác vụ vẫn dừng cả bước tổng hợp.

1. Bấm **Kết nối** rồi nhập base URL và API key trong hộp nhập bảo mật của VS Code.
2. Chọn **Model điều phối** từ danh sách proxy. Có thể dùng Opus, GPT hoặc bất kỳ model nào hỗ trợ workflow này.
3. Bấm **+ Session mới**, nhập yêu cầu, bật **Đọc project đang mở** nếu cần phân tích source, rồi bấm **Gửi yêu cầu**. Yêu cầu được xử lý ngay trong session trống đó. Tên và đường dẫn project hiển thị ngay phía trên ô nhập. Với workspace nhiều folder, chọn folder trong hộp thoại. Workspace chưa trusted hoặc chưa mở folder chỉ dùng được yêu cầu văn bản. Nội dung source được đọc sẽ gửi tới proxy đã cấu hình. Command **Phân tích & lên plan** vẫn dùng được qua Command Palette.
4. PO đọc mẫu source và trình bày 1–3 hướng trong **Đề xuất & demo**: hiểu yêu cầu, lý do, demo trải nghiệm, đầu ra, giả định/rủi ro và khoảng thời gian dự kiến. Có thể bấm **Tạo ảnh demo** bằng model ảnh thực trong proxy, hoặc trao đổi sửa đề xuất qua **Chat với PO**. Ảnh là minh họa, chưa phải level chạy thật. Chỉ sau **Duyệt hướng này & chia việc**, PO mới lập team linh hoạt tối đa 7 vị trí nghiệp vụ và Tech; kế hoạch tối đa 24 task có scope, phụ thuộc và checklist. Gợi ý model dựa trên phân tích của PO, không phải benchmark.
5. Chọn **model thực hiện cho từng vị trí**, xem chi tiết việc rồi bấm **Bắt đầu thực hiện**. Chưa có request worker nào được gửi trước bước này. Lựa chọn model được nhớ theo workspace và ID vị trí sau lượt thực hiện; model không còn trong catalog sẽ không được dùng lại.
6. Tối đa 3 việc độc lập chạy đồng thời. Các việc cùng vị trí hoặc có phạm vi chồng nhau được chạy lần lượt; việc phụ thuộc chờ kết quả và nhận cả đề xuất file từ bước trước. Khi một việc thất bại, các việc phụ thuộc bị chặn. File trùng giữa các việc độc lập sẽ chặn áp dụng.
7. Điều phối review toàn bộ kết quả. Báo cáo mở trong editor. Với code, **Xem thay đổi** mở diff; **Áp dụng** ghi các file sau khi bạn xác nhận. File bị chỉnh bên ngoài từ lúc nhận đề xuất sẽ không bị ghi đè. Đề xuất ngoài phạm vi được giao sẽ bị từ chối.
8. **Dừng / hủy plan** hủy request hoặc plan chưa chạy của lượt đang chọn. **Quét model** cập nhật danh sách từ server. Đổi base URL sau khi lập plan cần lập plan mới.

## Bổ sung việc, chi tiết và kết quả

### Đổi model trong cùng session (0.6.5)

Bấm một thẻ vị trí trong **Team / model** (kể cả PO), chọn model rồi bấm **Đổi model**. Model văn bản đổi sang model văn bản; vị trí tạo ảnh chọn model ảnh trong catalog proxy.

- Vị trí đang rảnh, đã lỗi hoặc session đã dừng: đổi ngay. Session đã kết thúc giữ nguyên báo cáo/kết quả; dùng **Tiếp tục** để chạy phần dở khi cần.
- Vị trí đang chạy: hoàn tất phần hiện tại rồi tự đổi, tối đa **180 giây tính từ lần bấm Đổi đầu tiên**. UI hiển thị model đích và đếm ngược; bấm lại không gia hạn. Không mở thêm vòng đọc tool khi đang bàn giao; model tổng hợp phần đã có và báo thật phần chưa hoàn thành.
- Hết hạn: hủy request cũ và tiếp tục task chưa xong bằng model mới. Phản hồi muộn bị bỏ qua. Task đã xong và PNG đã lưu được giữ; các vị trí khác tiếp tục. Đổi model ảnh có thể thực hiện ngay sau mỗi PNG đã lưu.
- Lựa chọn lưu theo session, khôi phục sau khi mở lại VS Code, giữ nguyên mốc bàn giao. Pause/Stop vẫn có hiệu lực. Lệnh MCP bị ngắt giữ trạng thái `uncertain`; PO phải kiểm tra thực trạng trước khi lặp thao tác.

Đây là chuyển ở checkpoint: request dở có thể cần gọi lại; không chuyển được trạng thái suy luận bên trong giữa hai model. Không tạo session mới hoặc thay API key, base URL, catalog hay cấu hình MCP.

- **+ Giao thêm task:** tự chọn vị trí nhận việc, nhập yêu cầu, phạm vi file và các việc cần hoàn thành trước. Dùng được sau khi AI đã lập plan và trong lúc worker đang làm.
- **+ Thêm vị trí:** nhập tên, trách nhiệm, chọn model và giao việc đầu tiên. Vị trí mới tham gia hàng đợi hiện tại; vẫn áp dụng giới hạn 8 vị trí, 24 việc và 3 worker đồng thời. Bạn bổ sung thủ công trước bước review; trong review, PO có thể tự thêm task/vị trí.
- Bấm thẻ model/vị trí hoặc robot trong Office 3D để xem yêu cầu, kết quả, file đã đọc, hoạt động tool và lỗi. **Dừng riêng vị trí này** hủy request hiện tại và các việc chưa chạy của vị trí đó; vị trí khác vẫn tiếp tục. Việc phụ thuộc vào phần đã dừng bị chặn. Dừng điều phối sẽ dừng cả lượt.
- Tab **Kết quả** hiển thị nội dung trả lời của từng việc khi đã có, kể cả kết quả một phần nếu lượt bị dừng/lỗi. Báo cáo tổng hợp và review có sau khi điều phối hoàn tất. **Mở báo cáo trong editor** đọc file Markdown đã lưu.
- Plan, checkpoint, kết quả và báo cáo lưu theo project. **Tạm dừng / Tiếp tục** giữ cùng session ID sau khi mất mạng hoặc khởi động lại VS Code. Task đã xong được giữ; task dở/lỗi chạy lại, PNG đã nhận được tái sử dụng. Request đang dở có thể phải gọi lại. MCP bị ngắt giữa chừng được ghi `uncertain`; PO phải kiểm tra trạng thái thực trước khi lặp thao tác. Code đề xuất vẫn cần xem diff và áp dụng trong phiên extension đã tạo kết quả.

Tự nhận diện Inwave tại `llmproxy.inwave.vn`: ba model `claude-*-5-5` đi base không có `/v1` và User-Agent `claude-cli`; GPT đi base có `/v1`. Với proxy khác, giữ base đã nhập/quét được. Giao tiếp hỗ trợ Chat Completions và Responses, chỉ thử endpoint còn lại khi server trả 404/405/501.

Model văn bản cần hỗ trợ JSON và function tools. Danh sách `/models` không đảm bảo tài khoản gọi được mọi model. Mỗi bước tối đa 24 vòng tool rồi tổng hợp; request văn bản và ảnh chờ tối đa 300 giây, có thể hủy/tạm dừng. Worker chỉ có công cụ đọc source; PO được gọi các công cụ MCP đã kết nối. Test/Unity chỉ được coi đã chạy khi có bằng chứng trả về từ công cụ.

## PO, Tech và báo cáo nghiệm thu (0.6.0)

- Mỗi team mới có **Tech · Hệ thống**, chọn được model như các vị trí khác. Tech chạy sau các task nghiệp vụ, nhận lỗi runtime/model/endpoint/tool và báo cáo nguyên nhân, cách khắc phục và blocker. Task Tech không bị chặn chỉ vì worker khác thất bại. Khi PO giao sửa, Tech đánh giá lại vòng mới. Session cũ được bổ sung Tech khi khôi phục/tiếp tục, giữ nguyên kết quả cũ.
- PO đặt `acceptance` cho từng task: ID, tiêu chí cụ thể và loại bằng chứng `analysis`, `file`, `image`, `tool`. Worker trả `checks` với pass/fail/blocked và bằng chứng. Thiếu báo cáo, thiếu file/PNG hoặc tool không xác minh được sẽ chặn duyệt cuối. Tiêu chí tool còn phải chỉ rõ `tool` và chuỗi `expected` xuất hiện trong kết quả thành công của đúng công cụ đó. Có bằng chứng là điều kiện cần, PO vẫn phải đánh giá tính đúng; tự tick pass không chứng minh chất lượng code.
- PO mặc định nhận summary, checklist, danh sách file, kích thước và SHA-256; không gửi toàn bộ code cho mỗi lần review. `inspect_proposal` đọc riêng file cần kiểm tra khi có vấn đề hoặc cần kiểm tra mẫu. PO có thể giao sửa, thêm vị trí/task, hoặc đổi model của vị trí qua `roleModels`. Task bị ảnh hưởng và các task phụ thuộc được chạy lại trong cùng session, giữ lịch sử từng vòng. Tối đa 3 vòng sửa; không đạt sẽ trả báo cáo blocker thay vì báo hoàn tất.
- Tab **Log trực tiếp** gộp sự kiện cả team trong session: model, task, giao việc, đọc file, kết quả, lỗi, MCP, pause và review. Có tìm kiếm, lọc lỗi/Tech, tự cuộn. UI hiện 2000 dòng mới nhất; **Mở log đầy đủ** mở toàn bộ JSONL đã lưu theo project.

## Tạo ảnh thật

**Tạo ảnh** chọn model ảnh, prompt, tỷ lệ và nền. `gpt-image-2.5-sunburst` dùng `/v1/images/generations`, không gửi nhầm Chat/Responses. Task ảnh do PO giao cũng đi qua pipeline này. API cần trả PNG trong `b64_json`; extension kiểm tra header và lưu PNG cùng session. Tab Kết quả có preview, prompt, kích thước thực tế, mở ảnh và **Lưu vào project**. Kích thước thực tế có thể khác kích thước yêu cầu nếu proxy không tuân thủ tham số; UI báo số đo thực. Không tự gán sprite/material/scene Unity. Chưa hỗ trợ Images Edits hoặc kết quả chỉ có URL.

## Kết nối MCP riêng cho extension

Nút **Công cụ MCP** thêm/kiểm tra/ngắt server. Hỗ trợ Streamable HTTP (`http`), SSE (`sse`) và `stdio` qua SDK MCP chính thức. Ví dụ cấu hình Unity: `{"id":"unity","type":"http","url":"http://127.0.0.1:8080/mcp"}`; stdio: `{"id":"research","type":"stdio","command":"đường-dẫn-chương-trình","args":[]}`. Bearer token nhập riêng và lưu SecretStorage, không đưa vào webview. Server dùng credential từ môi trường riêng của tiến trình stdio nếu cần.

PO khám phá tên/schema công cụ và resources thật, sau đó trực tiếp gọi công cụ để thao tác/kiểm chứng. Worker gửi báo cáo và đề xuất; PO điều khiển công cụ trong bước review. Kết nối đóng khi kết thúc/pause hoặc extension dừng. Tool được đặt namespace riêng để không trùng tên giữa server. Server phải tự cung cấp đúng khả năng Unity/PC/research; plugin của Codex không tự được chia sẻ sang VS Code. Extension không tự khởi động Unity hoặc cài plugin PC/research. Không gửi thông điệp cho người khác, xuất bản hoặc thao tác phá hủy khi chưa có yêu cầu cụ thể của người dùng.

## Project và session

Mỗi project chứa nhiều session độc lập. Session giữ yêu cầu, team, plan, task, hoạt động và kết quả riêng. **+ Session mới** tạo session trống, chưa gọi model và chưa cần kết nối proxy. **Đổi tên** giúp phân biệt các session. Chuyển session không dừng team đang làm. Danh sách ở Activity Bar cũng chỉ chứa session của workspace hiện tại.

Nội dung đang nhập được lưu riêng theo session trong workspace và khôi phục khi mở lại. Gửi yêu cầu trong session trống dùng chính session đó. **Chat với PO** giữ lịch sử nhiều lượt, kể cả sau khi kết thúc: hỏi tiến độ, đổi hướng, thêm việc hoặc yêu cầu làm lại. Khi team đang chạy, PO xử lý tin ở ranh giới batch/review để giữ phần việc đang làm. Thay đổi plan phải qua kiểm tra model/scope/phụ thuộc; chỉ task bị ảnh hưởng và task phụ thuộc chạy lại. Tin lỗi có nút gửi lại và chặn duyệt để không bỏ sót chỉ dẫn CEO. **Giao thêm task / Thêm vị trí** vẫn dùng được khi chờ hoặc đang làm. **Tạo session từ yêu cầu** tạo session riêng. Session cũ được giữ nguyên.

## Đề xuất, lịch sản xuất và phục hồi (0.7.0)

CEO duyệt hướng trước khi chia team. Có thể sửa đề xuất qua Chat; proposal mới cần duyệt lại và không tái dùng ảnh của hướng cũ. Nếu proxy chưa có model ảnh, demo trải nghiệm bằng mô tả vẫn dùng được. Kế hoạch chi tiết tính lại thời gian theo tối đa 3 task đồng thời, cùng vị trí/scope chạy lần lượt và phụ thuộc; thêm 3 phút review cùng khoảng dự phòng 20%. Đây là ước tính có giả định, không bảo đảm tốc độ của proxy/Unity. Màn kế hoạch hiện cả khoảng ban đầu và lịch chi tiết để xem trước khi bắt đầu.

Mỗi task và vị trí có hạn dự kiến; hạn được neo lại lúc bấm Bắt đầu. Worker nhận hướng đã duyệt, thời hạn, scope, checklist và quy tắc sản xuất: đọc nguồn trước khi sửa, phần việc nhỏ, bằng chứng thật, không mở rộng phạm vi, báo Tech/PO khi lỗi và báo thiếu khi trễ. ETA cập nhật ở ranh giới xử lý. Thời gian thực từng task và hoạt động session được lưu; thời gian tạm dừng không tính và khoảng mất dấu do host sập được ghi rõ. Vượt dự kiến không tự hủy kết quả.

HTTP 408 từ LiteLLM có thể là timeout 120 giây phía server dù timeout client dài hơn. Runtime thử phục hồi một lần cho mỗi task lỗi tạm thời, kèm chỉ dẫn thu gọn đầu ra; không chặn việc phụ thuộc trước khi lần này kết thúc. Đọc `read_excerpt` hỗ trợ trích đoạn file nguồn/prefab đến 4 MB; bản vá `filePatches` dùng đoạn gốc chính xác, không cần model trả lại toàn file lớn. Mô hình vẫn phải báo thiếu công cụ/test trung thực. Lỗi kéo dài cần proxy phục hồi hoặc PO đổi cách chia việc/model. Bảng việc gom task bị chặn dưới lỗi gốc. **Tiếp tục** giữ session và kết quả đã xong, mở lại ngân sách vòng review và retry; không lặp vô hạn hoặc tự coi blocker là pass.

**Chat với PO** có hàng quyết định CEO cho lựa chọn phạm vi/hướng sản phẩm. PO/Tech tự xử lý quyết định kỹ thuật thường lệ. **Kết quả** phân biệt code đề xuất/đã áp dụng, PNG đã tạo/chưa import, tiêu chí có kết quả công cụ thật và phần chưa hoàn tất. Yêu cầu mới làm báo cáo cũ hết hiệu lực cho tới review lại.

**Tài nguyên** trong menu Khác hiển thị từng vị trí/model: lượt gọi, retry, lỗi, thời gian và token do API thực sự trả. Thiếu usage hiện chưa biết; không ước lượng giả. Ngân sách lượt gọi/token giữ theo session và tạm dừng trước lần gọi vượt giới hạn; 0 là không giới hạn. Giá chỉ tính khi CEO tự nhập đúng giá của từng model; giá input/output/cached theo một triệu token, giá image theo ảnh. Retry hoặc usage thiếu khiến chi phí chưa đầy đủ. Không thay đổi key hay cấu hình proxy.

Từ 0.4.0, lịch sử được tách theo workspace trong `<thư-mục-gốc>/projects/<workspace-id>`. Thư mục gốc mặc định là `%LOCALAPPDATA%\InwaveModelRouter\teams`, hoặc `INWAVE_TEAM_DIR`, hoặc setting `poTeam.eventsDir`. Workspace-id tính từ đường dẫn workspace/folder, không dùng tên project. Mở project khác không hiện việc của project trước. Kết nối proxy/API key vẫn dùng chung, không bị xóa khi đổi project.

Nhật ký chung của các bản trước được giữ nguyên tại thư mục gốc, không tự gán vào một project vì chúng chưa có thông tin sở hữu project. Có thể sao chép các file nhật ký đã biết rõ thuộc project nào vào thư mục của project đó bằng **PO Team: Mở thư mục nhật ký**.

Mỗi file `<run-id>.jsonl` là một lượt chạy. Nhiều lượt chạy dùng chung extension, không cần cổng riêng hay sinh lại HTML/JS. Khi ghi thêm một dòng hoàn chỉnh, giao diện cập nhật sau khoảng 700 ms.

Ví dụ một dòng sự kiện:

```json
{"ts":"2026-10-23T04:00:00Z","run":"login-1","agent":"opus","type":"assign","to":"sonnet","task":"Form đăng nhập","path":"src/ui/Login.tsx"}
```

Nhật ký cũ với agent IDs `opus`, `sonnet`, `sol` vẫn dùng được. Lượt mới khai báo các vị trí bằng event `team` với `coordinator` và `members: [{id,name,responsibility,model}]`. Event `ready` đánh dấu chờ chọn model; `taskId` phân biệt các việc cùng vị trí hoặc cùng tên. `queued` là việc bổ sung, `result` là nội dung kết quả, `stopped` là vị trí/việc bị dừng. Event types khác: `start`, `plan`, `assign`, `working`, `file`, `note`, `done`, `review`, `approved`, `rework`, `error`, `end`. `path` phải tương đối với workspace. File `.state.json` lưu plan, kết quả và bản đề xuất; không lưu API key. Nội dung kết quả và code đề xuất có trên đĩa nên không đưa token/bí mật vào yêu cầu.

## Các chế độ xem

Từ 0.6.6, session và team nằm trong cột trái; mỗi vị trí hiển thị tên, model và trạng thái. Tên dài xuống dòng, danh sách team cuộn riêng. Nút góc trái thu danh sách thành dải avatar. Vùng chính ưu tiên **Office 3D**, **Bảng việc**, **Kết quả**, **Log**; **Timeline**, **Luồng việc**, **Tài nguyên** nằm trong menu **Khác**.

**Yêu cầu**, **Kế hoạch**, **Proxy & model** và **Phát lại hoạt động** dùng chung một bảng mở khi cần. Bấm một vị trí để xem chi tiết, kết quả, nhật ký và mục **Đổi model**; chỉ mở một bảng chi tiết tại một thời điểm. Đổi model khi đang làm vẫn bàn giao tối đa 3 phút; bộ đếm tự hiện khi có yêu cầu chờ. Nhấn Escape hoặc nút đóng để quay lại. **Tạm dừng** / **Tiếp tục** hiện theo trạng thái; giao thêm việc, thêm vị trí và thao tác báo cáo nằm trong menu ba chấm của session.

Kéo mép cột trái, bảng điều khiển hoặc bảng chi tiết để đổi chiều rộng; tay nắm hỗ trợ phím mũi tên, Home và nhấp đúp để đặt lại. Trạng thái thu gọn và kích thước được lưu riêng, không thay đổi session hay kết nối. Trên màn hình hẹp, danh sách team mở dạng bảng phủ và tự đóng khi chọn vị trí. Giao diện dùng màu theme VS Code, hỗ trợ theme sáng và giảm chuyển động.

Trong **Công cụ** có Tạo ảnh, Kết nối MCP, Proxy, phát lại và demo. **Tập trung** ẩn các phần phụ; **Mở lại bố cục** trả về bố cục trước đó. Mục **Bố cục** cho phép bật/tắt team, hoạt động trên 3D, chi tiết vị trí và **Đặt lại bố cục**.

- **Office 3D:** robot di chuyển tới thư mục đang làm, file sáng lên, thẻ việc bay khi giao/hoàn tất. Nhãn tên và trạng thái được rút gọn để giảm che nhau; bấm robot hoặc vị trí trong team để đọc đầy đủ. Kéo để xoay, cuộn để zoom, bấm tên file để mở.
- **Bảng việc:** theo dõi được giao → đang làm → chờ review → đã duyệt; lỗi và yêu cầu sửa vào cột cần xử lý.
- **Kết quả:** nội dung trả lời từng việc, lỗi hoặc trạng thái dừng, báo cáo tổng hợp và review.
- **Timeline:** thời gian làm, review và thời điểm duyệt theo từng việc, dựa trên timestamp được ghi.
- **Luồng việc:** quan hệ giao việc, chỉnh sửa file, trả kết quả và yêu cầu sửa.
- **Tài nguyên:** lượt gọi, retry, thời gian, usage API, giá cấu hình và ngân sách theo session.

Extension theo theme VS Code, có điều hướng tab bằng bàn phím và tôn trọng reduced motion. Nếu máy không hỗ trợ WebGL, năm chế độ còn lại vẫn dùng được.

## Cấu hình

| Setting | Mặc định | Ý nghĩa |
|---|---|---|
| `poTeam.eventsDir` | rỗng | Tự tìm thư mục nhật ký |
| `poTeam.defaultView` | `office` | Kiểu xem khi mở lần đầu |
| `poTeam.notify` | `true` | Báo lỗi và kết thúc lượt chạy |
| `poTeam.autoOpen` | `false` | Tự mở khi có lượt chạy mới |

## Phạm vi

Có hai nguồn dữ liệu: workflow trực tiếp của extension và nhật ký của skill/agent bên ngoài. Workflow trực tiếp gọi proxy bằng API key riêng; chế độ đọc nhật ký không điều khiển agent đang chạy trong Codex. Extension không sửa cấu hình hoặc thông tin đăng nhập Codex/Inwave. Không tự nhập key từ Codex. Kết quả live từ một proxy cụ thể cần được kiểm tra sau khi bạn nhập key.

## Phát triển

Từ 0.6.1, **Công cụ MCP → Unity MCP · project đang mở** hoặc command **PO Team: Kết nối Unity MCP** tự kiểm tra `http://127.0.0.1:8080/mcp`, xác nhận Unity đang mở đúng project rồi lưu kết nối riêng trong workspace. Ô thêm MCP nhận URL trực tiếp hoặc JSON; các cấu hình MCP toàn cục cũ vẫn được giữ. Không thay đổi API key/proxy hay tạo session mới. MCP tích hợp của VS Code dùng cấu hình riêng tại User `mcp.json` hoặc `.vscode/mcp.json`.

Từ 0.6.2, HTTP 408 được thử lại một lần trong thời hạn chờ hiện có, giữ nguyên model/URL/body/auth. Log và thẻ task hiện trạng thái thử lại. Cảnh báo lỗi gốc được gộp theo model/loại lỗi trong cùng session; task bị chặn bởi việc phụ thuộc vẫn hiện trong bảng và log nhưng không bật thêm toast. Lượt kết thúc chưa đạt phát cảnh báo thay vì thông báo thành công. Khi task làm lại, thẻ bỏ ghi chú lỗi cũ khỏi phần trạng thái hiện tại; lịch sử lỗi vẫn được giữ. Timeout phía proxy không thay đổi.

Từ 0.6.3, Tech có thể gửi `modelRecommendations` trong báo cáo để đề xuất thay Opus ở một vị trí hoặc quyền PO bằng đúng `gpt-6.1-sol` trong catalog. PO quyết định đổi worker qua `roleModels`, hoặc bàn giao quyền PO qua `coordinatorModel` với `approved:false`; Sol phải review lại trước khi duyệt. Nếu PO Opus lỗi 3 lần gọi model liên tiếp, runtime tự chuyển quyền sang Sol trong cùng session, giữ toàn bộ hội thoại tool hiện tại, plan, kết quả, checklist và lịch sử MCP. Mỗi lần gọi ở đây đã bao gồm các lần thử HTTP bên trong ProxyClient; một lần gọi thành công đặt lại bộ đếm, Pause/Stop không tính là lỗi. JSON cuối không đọc được cũng tính là lỗi gọi PO. Bộ đếm và lịch sử bàn giao được lưu để tiếp tục sau reload. Sol có đầy đủ quyền giao việc, thêm vị trí, đổi model worker, yêu cầu làm lại, dùng MCP và duyệt kết quả theo cùng các kiểm tra bằng chứng. Log có dòng **Chuyển quyền PO** và giao diện cập nhật model của PO. Việc chuyển chỉ áp dụng cho session đó; model mặc định của các session mới và cấu hình proxy/auth được giữ nguyên. Nếu catalog không có đúng `gpt-6.1-sol`, session báo blocker để tiếp tục sau, không tự dùng model khác. Sol lỗi sẽ báo lỗi để xử lý, không tự chuyển ngược về Opus.

Từ 0.6.4, các prompt lập kế hoạch, worker, review và chuẩn bị brief ảnh đều có ngữ cảnh **studio làm game Unity**: người dùng là CEO giao mục tiêu, model điều phối là PO chịu trách nhiệm chia việc và báo cáo kết quả cuối cùng cho CEO. PO vẫn chọn nhiều vị trí động theo yêu cầu, chẳng hạn gameplay, level design, art, animation, VFX, audio, UI, QA, build hoặc tối ưu; không có danh sách 5 bộ phận bắt buộc và không chia đều số task một cách máy móc. Đây là bổ sung ngữ cảnh cho AI; luồng plan/start, giới hạn team, model, scheduler, Tech, MCP, checklist, pause/resume, chuyển quyền PO và session giữ nguyên. Mô tả môi trường không tự cài tool hoặc chứng minh đã compile/chạy Unity.

Không có bước build cho source JavaScript. Nhấn F5 từ project extension hoặc mở VS Code với `--extensionDevelopmentPath=<project>`. Test PowerShell: `$tests = Get-ChildItem test -Filter '*.test.cjs' | Select-Object -ExpandProperty FullName; node --test --test-concurrency=1 $tests`. Đóng gói: `npx @vscode/vsce package --allow-missing-repository`.

Three.js 0.170.0 và OrbitControls được phân phối kèm theo giấy phép MIT ở `media/vendor/THREE-LICENSE.txt`.
