using System.Security.Cryptography;
using System.Text;

// 凭据仅经匿名 stdin/stdout 管道传递；命令行、临时文件和诊断中没有明文。
const int MaxBytes = 128 * 1024;
if (args.Length != 1 || args[0] is not ("protect" or "unprotect")) return 2;
byte[]? input = null, output = null;
try
{
    using var stream = Console.OpenStandardInput();
    using var buffer = new MemoryStream();
    var chunk = new byte[4096];
    int read;
    while ((read = stream.Read(chunk)) > 0)
    {
        if (buffer.Length + read > MaxBytes) return 3;
        buffer.Write(chunk, 0, read);
    }
    input = buffer.ToArray();
    if (input.Length == 0) return 3;
    var entropy = Encoding.UTF8.GetBytes("NachoPanel.Connection.v2");
    output = args[0] == "protect"
        ? ProtectedData.Protect(input, entropy, DataProtectionScope.CurrentUser)
        : ProtectedData.Unprotect(input, entropy, DataProtectionScope.CurrentUser);
    using var stdout = Console.OpenStandardOutput();
    stdout.Write(output);
    return 0;
}
catch
{
    Console.Error.Write("DPAPI_OPERATION_FAILED");
    return 1;
}
finally
{
    if (input is not null) CryptographicOperations.ZeroMemory(input);
    if (output is not null) CryptographicOperations.ZeroMemory(output);
}
