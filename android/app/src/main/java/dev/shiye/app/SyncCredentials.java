package dev.shiye.app;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Private credential envelope. No plaintext fallback, export or backup key. */
final class SyncCredentials {
    interface KeyProvider { SecretKey get() throws Exception; }
    private final KeyProvider provider;
    SyncCredentials() { this(new KeyProvider() {
        public SecretKey get() throws Exception {
            String alias = "shiye.sync.credentials.v1";
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (store.containsAlias(alias)) return (SecretKey) store.getKey(alias, null);
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            return generator.generateKey();
        }
    }); }
    SyncCredentials(KeyProvider provider) { this.provider = provider; }
    String encrypt(String base, String plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, provider.get());
        cipher.updateAAD(base.getBytes(StandardCharsets.UTF_8));
        return "1." + Base64.getEncoder().encodeToString(cipher.getIV()) + "."
            + Base64.getEncoder().encodeToString(cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8)));
    }
    String decrypt(String base, String envelope) throws Exception {
        if (envelope.length() > 16384) throw new IllegalArgumentException();
        String[] pieces = envelope.split("\\.", -1);
        if (pieces.length != 3 || !pieces[0].equals("1")) throw new IllegalArgumentException();
        byte[] iv = Base64.getDecoder().decode(pieces[1]);
        if (iv.length != 12) throw new IllegalArgumentException();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, provider.get(), new GCMParameterSpec(128, iv));
        cipher.updateAAD(base.getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(Base64.getDecoder().decode(pieces[2])), StandardCharsets.UTF_8);
    }
    static String key(String base) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(base.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder("credential.");
            for (byte b : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
            return result.toString();
        } catch (Exception impossible) { throw new IllegalStateException(); }
    }
}
