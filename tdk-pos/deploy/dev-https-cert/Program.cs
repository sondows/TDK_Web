using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

var ip = args.Length > 0 ? IPAddress.Parse(args[0]) : IPAddress.Parse("192.168.0.54");
if (ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
    throw new ArgumentException("The development certificate requires an IPv4 SAN.");

var outputDirectory = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TDKON", "DevHttps");
Directory.CreateDirectory(outputDirectory);
var now = DateTimeOffset.UtcNow;

using var rootKey = RSA.Create(3072);
var rootRequest = new CertificateRequest(
    "CN=TDKON Local Development CA", rootKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
rootRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, true, 0, true));
rootRequest.CertificateExtensions.Add(new X509KeyUsageExtension(
    X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign | X509KeyUsageFlags.DigitalSignature, true));
rootRequest.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(rootRequest.PublicKey, false));
using var root = rootRequest.CreateSelfSigned(now.AddMinutes(-5), now.AddYears(5));

using var leafKey = RSA.Create(2048);
var leafRequest = new CertificateRequest(
    $"CN=TDKON Development HTTPS {ip}", leafKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
var san = new SubjectAlternativeNameBuilder();
san.AddIpAddress(ip);
leafRequest.CertificateExtensions.Add(san.Build());
leafRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
leafRequest.CertificateExtensions.Add(new X509KeyUsageExtension(
    X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
var eku = new OidCollection { new("1.3.6.1.5.5.7.3.1") };
leafRequest.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(eku, false));
leafRequest.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(leafRequest.PublicKey, false));
var serial = RandomNumberGenerator.GetBytes(16);
serial[0] &= 0x7f;
serial[0] |= 0x01;
using var publicLeaf = leafRequest.Create(root, now.AddMinutes(-5), now.AddDays(180), serial);
using var leaf = publicLeaf.CopyWithPrivateKey(leafKey);

var pfxPassword = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
File.WriteAllBytes(Path.Combine(outputDirectory, "server.pfx"),
    leaf.Export(X509ContentType.Pfx, pfxPassword));
File.WriteAllBytes(Path.Combine(outputDirectory, "root-ca.cer"), root.Export(X509ContentType.Cert));
File.WriteAllText(Path.Combine(outputDirectory, "pfx-password.txt"), pfxPassword);

using var chain = new X509Chain();
chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
chain.ChainPolicy.CustomTrustStore.Add(root);
chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
if (!chain.Build(leaf)) throw new InvalidOperationException("Generated certificate chain validation failed.");

Console.WriteLine($"Development HTTPS certificate prepared for IP SAN {ip}.");
Console.WriteLine($"Public Android trust certificate: {Path.Combine(outputDirectory, "root-ca.cer")}");
Console.WriteLine("TLS private key and its password are stored under the current user's LocalAppData.");
